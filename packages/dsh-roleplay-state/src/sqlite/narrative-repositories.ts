import type { JsonValue, NewSummary, PendingCommit, StoryThread, Summary, SummaryId, SummaryLevel, ThreadId, ThreadStatus } from 'dsh-roleplay-model'
import type { Clock } from '../clock.ts'
import type { SqlDatabase } from '../driver/types.ts'
import { CorruptDataError, NotFoundError } from '../errors.ts'
import type { PendingCommitRepository, SummaryRepository, ThreadRepository } from '../repositories.ts'
import { toJson } from './support.ts'

interface ThreadRow {
  id: number
  text: string
  status: ThreadStatus
  opened_turn: number
  resolved_turn: number | null
}

const toThread = (row: ThreadRow): StoryThread => ({
  id: row.id,
  text: row.text,
  status: row.status,
  openedTurn: row.opened_turn,
  ...(row.resolved_turn === null ? {} : { resolvedTurn: row.resolved_turn }),
})

export class SqliteThreadRepository implements ThreadRepository {
  constructor(private readonly db: SqlDatabase, private readonly clock: Clock) {}

  open(text: string, turn: number): StoryThread {
    const { lastInsertRowid } = this.db.run('INSERT INTO story_threads (text, status, opened_turn, created_at) VALUES (?, ?, ?, ?)', [text, 'open', turn, this.clock().toISOString()])
    return this.require(Number(lastInsertRowid))
  }

  get(id: ThreadId): StoryThread | undefined {
    const row = this.db.get<ThreadRow>('SELECT * FROM story_threads WHERE id = ?', [id])
    return row === undefined ? undefined : toThread(row)
  }

  list(status?: ThreadStatus): StoryThread[] {
    const rows = status === undefined
      ? this.db.all<ThreadRow>('SELECT * FROM story_threads ORDER BY id')
      : this.db.all<ThreadRow>('SELECT * FROM story_threads WHERE status = ? ORDER BY id', [status])
    return rows.map(toThread)
  }

  resolve(id: ThreadId, turn: number): StoryThread {
    this.require(id)
    this.db.run("UPDATE story_threads SET status = 'resolved', resolved_turn = ? WHERE id = ?", [turn, id])
    return this.require(id)
  }

  remove(id: ThreadId): boolean {
    return this.db.run('DELETE FROM story_threads WHERE id = ?', [id]).changes > 0
  }

  private require(id: ThreadId): StoryThread {
    const thread = this.get(id)
    if (thread === undefined) throw new NotFoundError(`thread ${id} does not exist`)
    return thread
  }
}

interface SummaryRow {
  id: number
  level: SummaryLevel
  from_turn: number
  to_turn: number
  text: string
  created_at: string
}

const toSummary = (row: SummaryRow): Summary => ({ id: row.id, level: row.level, fromTurn: row.from_turn, toTurn: row.to_turn, text: row.text, createdAt: row.created_at })

export class SqliteSummaryRepository implements SummaryRepository {
  constructor(private readonly db: SqlDatabase, private readonly clock: Clock) {}

  add(summary: NewSummary): Summary {
    const { lastInsertRowid } = this.db.run('INSERT INTO summaries (level, from_turn, to_turn, text, created_at) VALUES (?, ?, ?, ?, ?)', [summary.level, summary.fromTurn, summary.toTurn, summary.text, this.clock().toISOString()])
    const row = this.db.get<SummaryRow>('SELECT * FROM summaries WHERE id = ?', [Number(lastInsertRowid)])
    if (row === undefined) throw new NotFoundError('the summary was not stored')
    return toSummary(row)
  }

  list(level?: SummaryLevel): Summary[] {
    const rows = level === undefined
      ? this.db.all<SummaryRow>('SELECT * FROM summaries ORDER BY from_turn, id')
      : this.db.all<SummaryRow>('SELECT * FROM summaries WHERE level = ? ORDER BY from_turn, id', [level])
    return rows.map(toSummary)
  }

  remove(ids: readonly SummaryId[]): void {
    this.db.transaction(() => { for (const id of ids) this.db.run('DELETE FROM summaries WHERE id = ?', [id]) })
  }
}

export class SqlitePendingCommitRepository implements PendingCommitRepository {
  constructor(private readonly db: SqlDatabase, private readonly clock: Clock) {}

  enqueue(turn: number, round: number, payload: JsonValue): void {
    this.db.run('INSERT OR REPLACE INTO pending_commits (turn, round, payload, created_at) VALUES (?, ?, ?, ?)', [turn, round, toJson(payload), this.clock().toISOString()])
  }

  list(): PendingCommit[] {
    return this.db.all<{ turn: number; round: number; payload: string; created_at: string }>('SELECT * FROM pending_commits ORDER BY turn, round').map((row) => {
      try {
        return { turn: row.turn, round: row.round, payload: JSON.parse(row.payload) as JsonValue, createdAt: row.created_at }
      } catch (error) {
        throw new CorruptDataError(`pending commit ${row.turn}.${row.round} does not hold JSON`, { cause: error })
      }
    })
  }

  complete(rounds: readonly { turn: number; round: number }[]): void {
    this.db.transaction(() => { for (const { turn, round } of rounds) this.db.run('DELETE FROM pending_commits WHERE turn = ? AND round = ?', [turn, round]) })
  }
}
