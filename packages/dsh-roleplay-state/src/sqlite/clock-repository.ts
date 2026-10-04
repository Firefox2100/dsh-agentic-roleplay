import type { ClockMode, ClockState, TimeChange, TimeChangeFilter, TimeChangeKind } from 'dsh-roleplay-model'
import type { SqlDatabase, SqlValue } from '../driver/types.ts'
import { ConflictError, InvalidValueError, NotFoundError } from '../errors.ts'
import type { ClockRepository } from '../repositories.ts'
import { guard } from './support.ts'

interface ClockRow { mode: ClockMode; now_ms: number }
interface LogRow { id: number; turn: number; round: number; kind: TimeChangeKind; from_ms: number; to_ms: number; reason: string }

const toChange = (row: LogRow): TimeChange => ({ id: row.id, turn: row.turn, round: row.round, kind: row.kind, from: row.from_ms, to: row.to_ms, reason: row.reason })

export class SqliteClockRepository implements ClockRepository {
  constructor(private readonly db: SqlDatabase) {}

  get(): ClockState | undefined {
    const row = this.db.get<ClockRow>('SELECT mode, now_ms FROM clock WHERE id = 1')
    return row === undefined ? undefined : { mode: row.mode, now: row.now_ms }
  }

  start(mode: ClockMode, now: number): ClockState {
    assertInstant(now)
    return guard(() => this.db.transaction(() => {
      if (this.get() !== undefined) throw new ConflictError('the clock is already started')
      this.db.run('INSERT INTO clock (id, mode, now_ms) VALUES (1, ?, ?)', [mode, now])
      this.db.run('INSERT INTO time_log (turn, round, kind, from_ms, to_ms, reason) VALUES (0, 0, ?, ?, ?, ?)', ['start', now, now, ''])
      return { mode, now }
    }))
  }

  advance(step: { to: number; turn: number; round: number; kind: Exclude<TimeChangeKind, 'start' | 'resync'>; reason?: string }): TimeChange {
    assertInstant(step.to)
    return guard(() => this.db.transaction(() => {
      const current = this.require()
      if (step.to < current.now) throw new InvalidValueError(`the story's time cannot go back: it is ${current.now} and ${step.to} is earlier`)
      return this.record(current.mode, current.now, step.to, step.turn, step.round, step.kind, step.reason ?? '')
    }))
  }

  resync(mode: ClockMode, now: number, turn: number, reason = ''): TimeChange {
    assertInstant(now)
    return guard(() => this.db.transaction(() => this.record(mode, this.require().now, now, turn, 0, 'resync', reason)))
  }

  log(filter: TimeChangeFilter = {}): TimeChange[] {
    const where: string[] = []
    const params: SqlValue[] = []
    const add = (clause: string, value: SqlValue): void => { where.push(clause); params.push(value) }
    if (filter.turn !== undefined) add('turn = ?', filter.turn)
    if (filter.round !== undefined) add('round = ?', filter.round)
    if (filter.fromTurn !== undefined) add('turn >= ?', filter.fromTurn)
    if (filter.toTurn !== undefined) add('turn <= ?', filter.toTurn)
    if (filter.kind !== undefined) add('kind = ?', filter.kind)
    return this.db.all<LogRow>(`SELECT * FROM time_log ${where.length === 0 ? '' : `WHERE ${where.join(' AND ')}`} ORDER BY id`, params).map(toChange)
  }

  at(turn: number, round: number): number | undefined {
    return this.db.get<{ from_ms: number }>("SELECT from_ms FROM time_log WHERE turn = ? AND round = ? AND kind IN ('elapsed', 'real') ORDER BY id LIMIT 1", [turn, round])?.from_ms
  }

  private require(): ClockState {
    const state = this.get()
    if (state === undefined) throw new NotFoundError('the clock is not started')
    return state
  }

  private record(mode: ClockMode, from: number, to: number, turn: number, round: number, kind: TimeChangeKind, reason: string): TimeChange {
    this.db.run('UPDATE clock SET mode = ?, now_ms = ? WHERE id = 1', [mode, to])
    const { lastInsertRowid } = this.db.run('INSERT INTO time_log (turn, round, kind, from_ms, to_ms, reason) VALUES (?, ?, ?, ?, ?, ?)', [turn, round, kind, from, to, reason])
    return { id: Number(lastInsertRowid), turn, round, kind, from, to, reason }
  }
}

function assertInstant(value: number): void {
  if (!Number.isSafeInteger(value) || Math.abs(value) > 8_640_000_000_000_000) throw new InvalidValueError(`${value} is not an instant (whole milliseconds since 1970)`)
}
