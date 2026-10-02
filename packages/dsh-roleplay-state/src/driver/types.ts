export type SqlValue = string | number | bigint | null | Uint8Array

export interface RunResult {
  changes: number
  lastInsertRowid: number
}

/**
 * The part of a SQLite connection the repositories rely on. It is synchronous
 * because the embedded drivers are; a driver for a different SQLite library
 * implements this interface and nothing else changes.
 */
export interface SqlDatabase {
  /** Run one or more statements without parameters or results. */
  exec(sql: string): void
  run(sql: string, params?: readonly SqlValue[]): RunResult
  get<Row = Record<string, SqlValue>>(sql: string, params?: readonly SqlValue[]): Row | undefined
  all<Row = Record<string, SqlValue>>(sql: string, params?: readonly SqlValue[]): Row[]
  /**
   * Run `fn` atomically: its changes are kept when it returns and undone when
   * it throws. A call inside another transaction joins it, and an error that
   * is caught inside only undoes the inner part.
   */
  transaction<T>(fn: () => T): T
  close(): void
}

export interface OpenOptions {
  /** Default `delete`, which keeps the database in a single file that can be copied. */
  journalMode?: 'delete' | 'wal'
  /** How long to wait for another connection's lock. Default 5000. */
  busyTimeoutMs?: number
}

export interface SqlDriver {
  /** Open the database at `location` (a file path, or `:memory:`), creating the file when missing. */
  open(location: string, options?: OpenOptions): SqlDatabase
}
