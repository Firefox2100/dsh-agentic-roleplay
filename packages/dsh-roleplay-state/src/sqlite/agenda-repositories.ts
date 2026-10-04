import type { CharacterId, Engagement, EngagementFilter, EngagementId, EngagementPatch, EngagementStatus, NewEngagement, RoutineWindow, StoredRoutineWindow } from 'dsh-roleplay-model'
import type { SqlDatabase, SqlValue } from '../driver/types.ts'
import { InvalidValueError, NotFoundError } from '../errors.ts'
import type { EngagementRepository, RoutineRepository } from '../repositories.ts'
import { guard, parseNumberList, toJson } from './support.ts'

/** At most this many windows for one character, so that a day stays something a model can hold. */
export const MAX_ROUTINE_WINDOWS = 24
const MAX_TITLE = 200

interface WindowRow {
  id: number
  character_id: number
  days: string
  start_minute: number
  end_minute: number
  activity: string
  location_id: number | null
  feature_key: string | null
  position: string
  interruptible: number
}

const toWindow = (row: WindowRow): StoredRoutineWindow => ({
  id: row.id,
  characterId: row.character_id,
  days: parseNumberList(row.days, 'routine_windows.days'),
  start: row.start_minute,
  end: row.end_minute,
  activity: row.activity,
  ...(row.location_id === null ? {} : { locationId: row.location_id }),
  ...(row.feature_key === null ? {} : { featureKey: row.feature_key }),
  ...(row.position === '' ? {} : { position: row.position }),
  interruptible: row.interruptible === 1,
})

const isMinute = (value: number): boolean => Number.isInteger(value) && value >= 0 && value < 1440

export class SqliteRoutineRepository implements RoutineRepository {
  constructor(private readonly db: SqlDatabase) {}

  list(characterId: CharacterId): StoredRoutineWindow[] {
    return this.db.all<WindowRow>('SELECT * FROM routine_windows WHERE character_id = ? ORDER BY ordinal', [characterId]).map(toWindow)
  }

  all(): StoredRoutineWindow[] {
    return this.db.all<WindowRow>('SELECT * FROM routine_windows ORDER BY character_id, ordinal').map(toWindow)
  }

  replace(characterId: CharacterId, windows: readonly RoutineWindow[]): StoredRoutineWindow[] {
    if (windows.length > MAX_ROUTINE_WINDOWS) throw new InvalidValueError(`a character has at most ${MAX_ROUTINE_WINDOWS} windows in its day`)
    windows.forEach((window, index) => {
      const at = `window ${index + 1}`
      if (!isMinute(window.start) || !isMinute(window.end)) throw new InvalidValueError(`${at}: a minute of the day is from 0 to 1439`)
      if (window.start === window.end) throw new InvalidValueError(`${at}: it starts and ends at the same minute`)
      if (window.days.some(day => !Number.isInteger(day) || day < 0 || day > 6)) throw new InvalidValueError(`${at}: a day of the week is from 0 (Sunday) to 6`)
      if (window.activity.trim() === '') throw new InvalidValueError(`${at}: say what the character is doing`)
    })
    return guard(() => this.db.transaction(() => {
      if (this.db.get('SELECT 1 FROM characters WHERE id = ?', [characterId]) === undefined) throw new NotFoundError(`character ${characterId} does not exist`)
      this.db.run('DELETE FROM routine_windows WHERE character_id = ?', [characterId])
      windows.forEach((window, index) => {
        this.db.run(
          'INSERT INTO routine_windows (character_id, ordinal, days, start_minute, end_minute, activity, location_id, feature_key, position, interruptible) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
          [characterId, index, toJson([...new Set(window.days)].sort()), window.start, window.end, window.activity.trim(), window.locationId ?? null, window.featureKey ?? null, window.position ?? '', window.interruptible ? 1 : 0],
        )
      })
      return this.list(characterId)
    }))
  }
}

interface EngagementRow {
  id: number
  title: string
  at_ms: number
  until_ms: number | null
  location_id: number | null
  status: EngagementStatus
  note: string
  created_turn: number
  updated_turn: number
}

export class SqliteEngagementRepository implements EngagementRepository {
  constructor(private readonly db: SqlDatabase) {}

  add(engagement: NewEngagement): Engagement {
    this.check(engagement.title, engagement.at, engagement.until, engagement.participants)
    return guard(() => this.db.transaction(() => {
      const { lastInsertRowid } = this.db.run(
        'INSERT INTO engagements (title, at_ms, until_ms, location_id, status, note, created_turn, updated_turn) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        [engagement.title.trim(), engagement.at, engagement.until ?? null, engagement.locationId ?? null, 'pending', engagement.note ?? '', engagement.turn, engagement.turn],
      )
      const id = Number(lastInsertRowid)
      this.setParticipants(id, engagement.participants)
      return this.require(id)
    }))
  }

  get(id: EngagementId): Engagement | undefined {
    const row = this.db.get<EngagementRow>('SELECT * FROM engagements WHERE id = ?', [id])
    return row === undefined ? undefined : this.toEngagement(row)
  }

  list(filter: EngagementFilter = {}): Engagement[] {
    const where: string[] = []
    const params: SqlValue[] = []
    const add = (clause: string, value: SqlValue): void => { where.push(clause); params.push(value) }
    if (filter.status !== undefined) add('status = ?', filter.status)
    if (filter.participant !== undefined) add('id IN (SELECT engagement_id FROM engagement_participants WHERE character_id = ?)', filter.participant)
    if (filter.from !== undefined) add('at_ms >= ?', filter.from)
    if (filter.to !== undefined) add('at_ms < ?', filter.to)
    return this.db.all<EngagementRow>(`SELECT * FROM engagements ${where.length === 0 ? '' : `WHERE ${where.join(' AND ')}`} ORDER BY at_ms, id`, params).map(row => this.toEngagement(row))
  }

  update(id: EngagementId, patch: EngagementPatch): Engagement {
    return guard(() => this.db.transaction(() => {
      const current = this.require(id)
      const at = patch.at ?? current.at
      const until = patch.until ?? current.until
      const participants = patch.participants ?? current.participants
      this.check(patch.title ?? current.title, at, until, participants)
      this.db.run('UPDATE engagements SET title = ?, at_ms = ?, until_ms = ?, location_id = ?, status = ?, note = ?, updated_turn = ? WHERE id = ?', [
        (patch.title ?? current.title).trim(), at, until ?? null, patch.locationId ?? current.locationId ?? null, patch.status ?? current.status, patch.note ?? current.note, patch.turn, id,
      ])
      if (patch.participants !== undefined) this.setParticipants(id, patch.participants)
      return this.require(id)
    }))
  }

  remove(id: EngagementId): boolean {
    return this.db.run('DELETE FROM engagements WHERE id = ?', [id]).changes > 0
  }

  private check(title: string, at: number, until: number | undefined, participants: readonly CharacterId[]): void {
    if (title.trim() === '' || title.trim().length > MAX_TITLE) throw new InvalidValueError(`an engagement needs a title of at most ${MAX_TITLE} characters`)
    if (!Number.isSafeInteger(at)) throw new InvalidValueError('an engagement needs the instant it is due')
    if (until !== undefined && (!Number.isSafeInteger(until) || until < at)) throw new InvalidValueError('an engagement cannot end before it is due')
    if (participants.length === 0) throw new InvalidValueError('an engagement needs at least one character who has committed to it')
  }

  private setParticipants(id: EngagementId, participants: readonly CharacterId[]): void {
    this.db.run('DELETE FROM engagement_participants WHERE engagement_id = ?', [id])
    for (const characterId of new Set(participants)) this.db.run('INSERT INTO engagement_participants (engagement_id, character_id) VALUES (?, ?)', [id, characterId])
  }

  private toEngagement(row: EngagementRow): Engagement {
    return {
      id: row.id, title: row.title, at: row.at_ms,
      ...(row.until_ms === null ? {} : { until: row.until_ms }),
      ...(row.location_id === null ? {} : { locationId: row.location_id }),
      participants: this.db.all<{ character_id: number }>('SELECT character_id FROM engagement_participants WHERE engagement_id = ? ORDER BY character_id', [row.id]).map(entry => entry.character_id),
      status: row.status, note: row.note, createdTurn: row.created_turn, updatedTurn: row.updated_turn,
    }
  }

  private require(id: EngagementId): Engagement {
    const found = this.get(id)
    if (found === undefined) throw new NotFoundError(`engagement ${id} does not exist`)
    return found
  }
}
