import { DatabaseSync, type StatementSync } from 'node:sqlite'
import type { OpenOptions, RunResult, SqlDatabase, SqlDriver, SqlValue } from './types.ts'

class NodeSqliteDatabase implements SqlDatabase {
  private readonly statements = new Map<string, StatementSync>()
  private depth = 0

  constructor(private readonly db: DatabaseSync) {}

  exec(sql: string): void {
    this.db.exec(sql)
  }

  run(sql: string, params: readonly SqlValue[] = []): RunResult {
    const result = this.statement(sql).run(...params)
    return { changes: Number(result.changes), lastInsertRowid: Number(result.lastInsertRowid) }
  }

  get<Row>(sql: string, params: readonly SqlValue[] = []): Row | undefined {
    return this.statement(sql).get(...params) as Row | undefined
  }

  all<Row>(sql: string, params: readonly SqlValue[] = []): Row[] {
    return this.statement(sql).all(...params) as Row[]
  }

  transaction<T>(fn: () => T): T {
    const outermost = this.depth === 0
    const savepoint = `nested_${this.depth}`
    this.db.exec(outermost ? 'BEGIN IMMEDIATE' : `SAVEPOINT ${savepoint}`)
    this.depth++
    let result: T
    try {
      result = fn()
      // A promise would settle after the transaction has ended.
      if (result instanceof Promise) throw new TypeError('a transaction callback must be synchronous')
    } catch (error) {
      this.depth--
      this.db.exec(outermost ? 'ROLLBACK' : `ROLLBACK TO ${savepoint}; RELEASE ${savepoint}`)
      throw error
    }
    this.depth--
    this.db.exec(outermost ? 'COMMIT' : `RELEASE ${savepoint}`)
    return result
  }

  close(): void {
    this.statements.clear()
    this.db.close()
  }

  private statement(sql: string): StatementSync {
    let statement = this.statements.get(sql)
    if (statement === undefined) {
      statement = this.db.prepare(sql)
      this.statements.set(sql, statement)
    }
    return statement
  }
}

/** The driver built on Node's bundled SQLite (`node:sqlite`); it needs no native dependency. */
export const nodeSqliteDriver: SqlDriver = {
  open(location: string, options: OpenOptions = {}): SqlDatabase {
    const busyTimeout = options.busyTimeoutMs ?? 5000
    if (!Number.isInteger(busyTimeout) || busyTimeout < 0) throw new RangeError('busyTimeoutMs must be a non-negative integer')
    const extensions = options.extensions ?? []
    const db = new DatabaseSync(location, { allowExtension: extensions.length > 0 })
    try {
      for (const path of extensions) db.loadExtension(path)
      db.exec('PRAGMA foreign_keys = ON')
      db.exec(`PRAGMA busy_timeout = ${busyTimeout}`)
      if (location !== ':memory:') db.exec(`PRAGMA journal_mode = ${options.journalMode === 'wal' ? 'WAL' : 'DELETE'}`)
    } catch (error) {
      db.close()
      throw error
    }
    return new NodeSqliteDatabase(db)
  },
}
