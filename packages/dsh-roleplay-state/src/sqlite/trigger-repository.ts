import { MAX_TRIGGERS, type NewTriggerNote, type Trigger, type TriggerAnnouncement, type TriggerCondition, type TriggerDefinition, type TriggerEffect, type TriggerId, type TriggerNote, type TriggerNoteKind, type TriggerStatus } from 'dsh-roleplay-model'
import type { SqlDatabase, SqlValue } from '../driver/types.ts'
import { CorruptDataError, InvalidValueError, NotFoundError } from '../errors.ts'
import type { TriggerRepository } from '../repositories.ts'
import { guard, parseNumberList, toJson } from './support.ts'

interface TriggerRow {
  id: number
  key: string
  name: string
  condition: string
  effects: string
  repeat: number
  cooldown_seconds: number | null
  chance: number | null
  priority: number
  expires: string | null
  announce: string | null
  status: TriggerStatus
  fire_count: number
  last_fired_ms: number | null
  last_result: number
  problem: string | null
  origin: Trigger['origin']
  created_turn: number
}

interface NoteRow {
  id: number
  trigger_id: number
  kind: TriggerNoteKind
  text: string
  character_ids: string
  turn: number
  status: TriggerNote['status']
}

const MAX_TEXT = 2000

function parse<T>(text: string, what: string): T {
  try {
    return JSON.parse(text) as T
  } catch (error) {
    throw new CorruptDataError(`a trigger's ${what} is not valid JSON`, { cause: error })
  }
}

export class SqliteTriggerRepository implements TriggerRepository {
  constructor(private readonly db: SqlDatabase) {}

  add(definition: TriggerDefinition, origin: Trigger['origin'], turn: number): Trigger {
    this.check(definition)
    if ((this.db.get<{ count: number }>('SELECT count(*) AS count FROM triggers')?.count ?? 0) >= MAX_TRIGGERS) throw new InvalidValueError(`a story has at most ${MAX_TRIGGERS} triggers`)
    return guard(() => {
      const { lastInsertRowid } = this.db.run(
        'INSERT INTO triggers (key, name, condition, effects, repeat, cooldown_seconds, chance, priority, expires, announce, origin, created_turn) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [definition.key, definition.name, toJson(definition.condition), toJson(definition.effects), definition.repeat ? 1 : 0, definition.cooldownSeconds ?? null, definition.chance ?? null, definition.priority, definition.expires ?? null, definition.announce === undefined ? null : toJson(definition.announce), origin, turn],
      )
      return this.require(Number(lastInsertRowid))
    })
  }

  get(id: TriggerId): Trigger | undefined {
    const row = this.db.get<TriggerRow>('SELECT * FROM triggers WHERE id = ?', [id])
    return row === undefined ? undefined : this.toTrigger(row)
  }

  getByKey(key: string): Trigger | undefined {
    const row = this.db.get<TriggerRow>('SELECT * FROM triggers WHERE key = ?', [key])
    return row === undefined ? undefined : this.toTrigger(row)
  }

  list(filter: { status?: TriggerStatus } = {}): Trigger[] {
    const rows = filter.status === undefined
      ? this.db.all<TriggerRow>('SELECT * FROM triggers ORDER BY priority DESC, id')
      : this.db.all<TriggerRow>('SELECT * FROM triggers WHERE status = ? ORDER BY priority DESC, id', [filter.status])
    return rows.map(row => this.toTrigger(row))
  }

  update(id: TriggerId, patch: { status?: TriggerStatus; fireCount?: number; lastFiredMs?: number; lastResult?: boolean; problem?: string }): Trigger {
    const current = this.require(id)
    this.db.run('UPDATE triggers SET status = ?, fire_count = ?, last_fired_ms = ?, last_result = ?, problem = ? WHERE id = ?', [
      patch.status ?? current.status, patch.fireCount ?? current.fireCount, patch.lastFiredMs ?? current.lastFiredMs ?? null,
      (patch.lastResult ?? current.lastResult) ? 1 : 0, patch.problem ?? current.problem ?? null, id,
    ])
    return this.require(id)
  }

  addNote(note: NewTriggerNote): TriggerNote {
    if (note.text.trim() === '' || note.text.length > MAX_TEXT) throw new InvalidValueError(`a note needs a text of at most ${MAX_TEXT} characters`)
    return guard(() => {
      const { lastInsertRowid } = this.db.run('INSERT INTO trigger_notes (trigger_id, kind, text, character_ids, turn) VALUES (?, ?, ?, ?, ?)', [note.triggerId, note.kind, note.text.trim(), toJson([...new Set(note.characterIds ?? [])]), note.turn])
      return this.requireNote(Number(lastInsertRowid))
    })
  }

  notes(filter: { status?: TriggerNote['status']; kind?: TriggerNoteKind } = {}): TriggerNote[] {
    const where: string[] = []
    const params: SqlValue[] = []
    if (filter.status !== undefined) { where.push('status = ?'); params.push(filter.status) }
    if (filter.kind !== undefined) { where.push('kind = ?'); params.push(filter.kind) }
    return this.db.all<NoteRow>(`SELECT * FROM trigger_notes ${where.length === 0 ? '' : `WHERE ${where.join(' AND ')}`} ORDER BY id`, params).map(row => this.toNote(row))
  }

  resolveNote(id: number, status: 'done' | 'lapsed'): void {
    if (this.db.run('UPDATE trigger_notes SET status = ? WHERE id = ?', [status, id]).changes === 0) throw new NotFoundError(`trigger note ${id} does not exist`)
  }

  private check(definition: TriggerDefinition): void {
    if (!/^[a-z0-9][a-z0-9_-]{0,63}$/.test(definition.key)) throw new InvalidValueError('a trigger key is lowercase letters, digits, hyphens and underscores, at most 64')
    if (definition.name.trim() === '' || definition.name.length > 200) throw new InvalidValueError('a trigger needs a name of at most 200 characters')
    if (definition.effects.length === 0) throw new InvalidValueError('a trigger needs at least one effect')
    if (definition.chance !== undefined && !(definition.chance >= 0 && definition.chance <= 1)) throw new InvalidValueError('a chance is from 0 to 1')
    if (definition.cooldownSeconds !== undefined && (!Number.isSafeInteger(definition.cooldownSeconds) || definition.cooldownSeconds < 0)) throw new InvalidValueError('a cooldown is a whole number of seconds')
    if (!Number.isSafeInteger(definition.priority)) throw new InvalidValueError('a priority is a whole number')
  }

  private toTrigger(row: TriggerRow): Trigger {
    return {
      id: row.id, key: row.key, name: row.name, condition: parse<TriggerCondition>(row.condition, 'condition'), effects: parse<TriggerEffect[]>(row.effects, 'effects'),
      repeat: row.repeat === 1, ...(row.cooldown_seconds === null ? {} : { cooldownSeconds: row.cooldown_seconds }), ...(row.chance === null ? {} : { chance: row.chance }),
      priority: row.priority, ...(row.expires === null ? {} : { expires: row.expires }), ...(row.announce === null ? {} : { announce: parse<TriggerAnnouncement>(row.announce, 'announcement') }), status: row.status, fireCount: row.fire_count,
      ...(row.last_fired_ms === null ? {} : { lastFiredMs: row.last_fired_ms }), lastResult: row.last_result === 1, ...(row.problem === null ? {} : { problem: row.problem }),
      origin: row.origin, createdTurn: row.created_turn,
    }
  }

  private toNote(row: NoteRow): TriggerNote {
    return { id: row.id, triggerId: row.trigger_id, kind: row.kind, text: row.text, characterIds: parseNumberList(row.character_ids, 'trigger_notes.character_ids'), turn: row.turn, status: row.status }
  }

  private require(id: TriggerId): Trigger {
    const found = this.get(id)
    if (found === undefined) throw new NotFoundError(`trigger ${id} does not exist`)
    return found
  }

  private requireNote(id: number): TriggerNote {
    const row = this.db.get<NoteRow>('SELECT * FROM trigger_notes WHERE id = ?', [id])
    if (row === undefined) throw new NotFoundError(`trigger note ${id} does not exist`)
    return this.toNote(row)
  }
}
