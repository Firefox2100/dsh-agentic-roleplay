import type { CharacterId, EventId, NewPerception, NewStoryEvent, PerceivedEvent, Perception, PerceptionId, PerceptionPatch, StoryEvent, StoryEventFilter, StoryEventPatch } from 'dsh-roleplay-model'
import type { Clock } from '../clock.ts'
import type { SqlDatabase, SqlValue } from '../driver/types.ts'
import { ConflictError, NotFoundError } from '../errors.ts'
import type { EventRepository } from '../repositories.ts'
import { guard, parseStringList, toJson } from './support.ts'

interface EventRow {
  id: number
  turn: number
  round: number
  text: string
  importance: number
  tags: string
  sealed: number
  created_at: string
}

interface PerceptionRow {
  id: number
  event_id: number
  character_id: number
  mode: Perception['mode']
  content: string
  gist: string
  accuracy: Perception['accuracy']
  recalls: number
  last_recalled_turn: number | null
  created_at: string
}

const toPerception = (row: PerceptionRow): Perception => ({
  id: row.id,
  eventId: row.event_id,
  characterId: row.character_id,
  mode: row.mode,
  content: row.content,
  gist: row.gist,
  accuracy: row.accuracy,
  recalls: row.recalls,
  ...(row.last_recalled_turn === null ? {} : { lastRecalledTurn: row.last_recalled_turn }),
  createdAt: row.created_at,
})

/** What the repository tells the index about its texts. */
export interface IndexWrites {
  put(item: { kind: 'perception' | 'memory' | 'event'; refId: number; characterId: number; text: string; extra?: string }): void
  remove(kind: 'perception' | 'memory' | 'event', refId: number): void
}

export class SqliteEventRepository implements EventRepository {
  constructor(private readonly db: SqlDatabase, private readonly clock: Clock, private readonly index: IndexWrites) {}

  add(event: NewStoryEvent, perceptions: readonly NewPerception[]): { event: StoryEvent; perceptions: Perception[] } {
    return guard(() => this.db.transaction(() => {
      const { lastInsertRowid } = this.db.run(
        'INSERT INTO events (turn, round, text, importance, tags, created_at) VALUES (?, ?, ?, ?, ?, ?)',
        [event.turn, event.round, event.text, event.importance, toJson(event.tags), this.clock().toISOString()],
      )
      const id = Number(lastInsertRowid)
      this.setInvolves(id, event.involves)
      const stored = this.replacePerceptions(id, perceptions)
      const kept = this.require(id)
      this.indexEvent(kept, stored)
      return { event: kept, perceptions: stored }
    }))
  }

  get(id: EventId): StoryEvent | undefined {
    const row = this.db.get<EventRow>('SELECT * FROM events WHERE id = ?', [id])
    return row === undefined ? undefined : this.toEvent(row)
  }

  list(filter: StoryEventFilter = {}): StoryEvent[] {
    const where: string[] = []
    const params: SqlValue[] = []
    const add = (clause: string, value: SqlValue): void => { where.push(clause); params.push(value) }
    if (filter.turn !== undefined) add('turn = ?', filter.turn)
    if (filter.round !== undefined) add('round = ?', filter.round)
    if (filter.fromTurn !== undefined) add('turn >= ?', filter.fromTurn)
    if (filter.toTurn !== undefined) add('turn <= ?', filter.toTurn)
    if (filter.minImportance !== undefined) add('importance >= ?', filter.minImportance)
    if (filter.involving !== undefined) add('id IN (SELECT event_id FROM event_involves WHERE character_id = ?)', filter.involving)
    const clause = where.length === 0 ? '' : `WHERE ${where.join(' AND ')}`
    return this.db.all<EventRow>(`SELECT * FROM events ${clause} ORDER BY turn, round, id`, params).map(row => this.toEvent(row))
  }

  update(id: EventId, patch: StoryEventPatch): StoryEvent {
    return guard(() => this.db.transaction(() => {
      const current = this.draft(id)
      this.db.run('UPDATE events SET text = ?, importance = ?, tags = ? WHERE id = ?', [
        patch.text ?? current.text, patch.importance ?? current.importance, toJson(patch.tags ?? current.tags), id,
      ])
      if (patch.involves !== undefined) this.setInvolves(id, patch.involves)
      const kept = this.require(id)
      this.indexEvent(kept, this.perceptionsOf(id))
      return kept
    }))
  }

  setPerceptions(id: EventId, perceptions: readonly NewPerception[]): Perception[] {
    return guard(() => this.db.transaction(() => {
      const event = this.draft(id)
      const stored = this.replacePerceptions(id, perceptions)
      this.indexEvent(event, stored)
      return stored
    }))
  }

  seal(ids?: readonly EventId[]): number {
    if (ids === undefined) return this.db.run('UPDATE events SET sealed = 1 WHERE sealed = 0').changes
    return this.db.transaction(() => ids.reduce((count, id) => count + this.db.run('UPDATE events SET sealed = 1 WHERE id = ? AND sealed = 0', [id]).changes, 0))
  }

  getPerception(id: PerceptionId): Perception | undefined {
    const row = this.db.get<PerceptionRow>('SELECT * FROM perceptions WHERE id = ?', [id])
    return row === undefined ? undefined : toPerception(row)
  }

  addPerception(id: EventId, perception: NewPerception): Perception {
    return guard(() => this.db.transaction(() => {
      const event = this.require(id)
      if (this.db.get('SELECT 1 FROM perceptions WHERE event_id = ? AND character_id = ?', [id, perception.characterId]) !== undefined) {
        throw new ConflictError(`character ${perception.characterId} already has a perception of event ${id}: revise that one`)
      }
      const { lastInsertRowid } = this.db.run(
        'INSERT INTO perceptions (event_id, character_id, mode, content, gist, accuracy, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [id, perception.characterId, perception.mode, perception.content, perception.gist, perception.accuracy, this.clock().toISOString()],
      )
      const added = this.requirePerception(Number(lastInsertRowid))
      this.indexPerception(event, added)
      return added
    }))
  }

  updatePerception(id: PerceptionId, patch: PerceptionPatch): Perception {
    return guard(() => this.db.transaction(() => {
      const current = this.requirePerception(id)
      this.db.run('UPDATE perceptions SET mode = ?, content = ?, gist = ?, accuracy = ? WHERE id = ?', [
        patch.mode ?? current.mode, patch.content ?? current.content, patch.gist ?? current.gist, patch.accuracy ?? current.accuracy, id,
      ])
      const revised = this.requirePerception(id)
      this.indexPerception(this.require(revised.eventId), revised)
      return revised
    }))
  }

  perceptionsOf(id: EventId): Perception[] {
    return this.db.all<PerceptionRow>('SELECT * FROM perceptions WHERE event_id = ? ORDER BY id', [id]).map(toPerception)
  }

  perceivedBy(characterId: CharacterId, filter: { fromTurn?: number; toTurn?: number } = {}): PerceivedEvent[] {
    const params: SqlValue[] = [characterId]
    let extra = ''
    if (filter.fromTurn !== undefined) { extra += ' AND e.turn >= ?'; params.push(filter.fromTurn) }
    if (filter.toTurn !== undefined) { extra += ' AND e.turn <= ?'; params.push(filter.toTurn) }
    const rows = this.db.all<PerceptionRow & { e_id: number }>(
      `SELECT p.*, e.id AS e_id FROM perceptions p JOIN events e ON e.id = p.event_id
       WHERE p.character_id = ?${extra} ORDER BY e.turn, e.round, e.id`,
      params,
    )
    return rows.flatMap((row) => {
      const event = this.get(row.e_id)
      return event === undefined ? [] : [{ perception: toPerception(row), event }]
    })
  }

  touchPerceptions(ids: readonly number[], turn: number): void {
    this.db.transaction(() => {
      for (const id of ids) this.db.run('UPDATE perceptions SET recalls = recalls + 1, last_recalled_turn = ? WHERE id = ?', [turn, id])
    })
  }

  remove(id: EventId): boolean {
    return this.db.transaction(() => {
      if (this.get(id)?.sealed === true) throw new ConflictError(`event ${id} is sealed: events cannot be removed once their records are complete`)
      for (const perception of this.perceptionsOf(id)) this.index.remove('perception', perception.id)
      this.index.remove('event', id)
      return this.db.run('DELETE FROM events WHERE id = ?', [id]).changes > 0
    })
  }

  /** Keep the index of an event and of what each character took in of it up to date. */
  private indexEvent(event: StoryEvent, perceptions: readonly Perception[]): void {
    this.index.put({ kind: 'event', refId: event.id, characterId: 0, text: event.text, extra: event.tags.join(' ') })
    for (const perception of perceptions) this.indexPerception(event, perception)
  }

  private indexPerception(event: StoryEvent, perception: Perception): void {
    this.index.put({ kind: 'perception', refId: perception.id, characterId: perception.characterId, text: perception.content, extra: event.tags.join(' ') })
  }

  private toEvent(row: EventRow): StoryEvent {
    const involves = this.db.all<{ character_id: number }>('SELECT character_id FROM event_involves WHERE event_id = ? ORDER BY character_id', [row.id]).map(entry => entry.character_id)
    return {
      id: row.id, turn: row.turn, round: row.round, text: row.text, importance: row.importance,
      tags: parseStringList(row.tags, 'events.tags'), involves, sealed: row.sealed === 1, createdAt: row.created_at,
    }
  }

  private require(id: EventId): StoryEvent {
    const event = this.get(id)
    if (event === undefined) throw new NotFoundError(`event ${id} does not exist`)
    return event
  }

  private draft(id: EventId): StoryEvent {
    const event = this.require(id)
    if (event.sealed) throw new ConflictError(`event ${id} is sealed: events cannot change once their records are complete`)
    return event
  }

  private requirePerception(id: PerceptionId): Perception {
    const found = this.getPerception(id)
    if (found === undefined) throw new NotFoundError(`perception ${id} does not exist`)
    return found
  }

  private setInvolves(id: EventId, characters: readonly CharacterId[]): void {
    this.db.run('DELETE FROM event_involves WHERE event_id = ?', [id])
    for (const characterId of new Set(characters)) this.db.run('INSERT INTO event_involves (event_id, character_id) VALUES (?, ?)', [id, characterId])
  }

  private replacePerceptions(id: EventId, perceptions: readonly NewPerception[]): Perception[] {
    const now = this.clock().toISOString()
    for (const old of this.perceptionsOf(id)) this.index.remove('perception', old.id)
    this.db.run('DELETE FROM perceptions WHERE event_id = ?', [id])
    for (const perception of perceptions) {
      this.db.run(
        'INSERT INTO perceptions (event_id, character_id, mode, content, gist, accuracy, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [id, perception.characterId, perception.mode, perception.content, perception.gist, perception.accuracy, now],
      )
    }
    return this.perceptionsOf(id)
  }
}
