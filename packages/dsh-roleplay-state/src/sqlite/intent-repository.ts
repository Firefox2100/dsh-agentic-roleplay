import type { CharacterId, CharacterIntent, Intent, IntentFilter, IntentId, IntentPatch } from 'dsh-roleplay-model'
import type { Clock } from '../clock.ts'
import type { SqlDatabase, SqlValue } from '../driver/types.ts'
import { NotFoundError } from '../errors.ts'
import type { IntentRepository } from '../repositories.ts'
import { guard, parseStringList, toJson } from './support.ts'

interface IntentRow {
  id: number
  character_id: number
  type: Intent['type']
  name: string
  description: string
  status: Intent['status']
  horizon: Intent['horizon']
  priority: number
  urgency: number
  plan: string
  open_threads: string
  constraints: string
  deadline: string | null
  created_at: string
  updated_at: string
}

function toIntent(row: IntentRow): CharacterIntent {
  return {
    id: row.id,
    characterId: row.character_id,
    type: row.type,
    name: row.name,
    description: row.description,
    status: row.status,
    horizon: row.horizon,
    priority: row.priority,
    urgency: row.urgency,
    plan: parseStringList(row.plan, 'intents.plan'),
    openThreads: parseStringList(row.open_threads, 'intents.open_threads'),
    constraints: parseStringList(row.constraints, 'intents.constraints'),
    ...(row.deadline === null ? {} : { deadline: row.deadline }),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export class SqliteIntentRepository implements IntentRepository {
  constructor(private readonly db: SqlDatabase, private readonly clock: Clock) {}

  add(characterId: CharacterId, intent: Intent): CharacterIntent {
    return guard(() => this.db.transaction(() => {
      if (this.db.get('SELECT 1 FROM characters WHERE id = ?', [characterId]) === undefined) {
        throw new NotFoundError(`character ${characterId} does not exist`)
      }
      const now = this.clock().toISOString()
      const { lastInsertRowid } = this.db.run(
        `INSERT INTO intents (
           character_id, type, name, description, status, horizon, priority, urgency,
           plan, open_threads, constraints, deadline, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          characterId, intent.type, intent.name, intent.description, intent.status, intent.horizon,
          intent.priority, intent.urgency, toJson(intent.plan), toJson(intent.openThreads), toJson(intent.constraints),
          intent.deadline ?? null, now, now,
        ],
      )
      return this.require(lastInsertRowid)
    }))
  }

  get(id: IntentId): CharacterIntent | undefined {
    const row = this.db.get<IntentRow>('SELECT * FROM intents WHERE id = ?', [id])
    return row === undefined ? undefined : toIntent(row)
  }

  list(characterId: CharacterId, filter: IntentFilter = {}): CharacterIntent[] {
    const params: SqlValue[] = [characterId]
    let where = 'character_id = ?'
    if (filter.status !== undefined) {
      where += ' AND status = ?'
      params.push(filter.status)
    }
    return this.db.all<IntentRow>(`SELECT * FROM intents WHERE ${where} ORDER BY id`, params).map(toIntent)
  }

  update(id: IntentId, patch: IntentPatch): CharacterIntent {
    return guard(() => this.db.transaction(() => {
      const current = this.require(id)
      const deadline = patch.deadline === undefined ? current.deadline ?? null : patch.deadline
      this.db.run(
        `UPDATE intents SET type = ?, name = ?, description = ?, status = ?, horizon = ?, priority = ?, urgency = ?,
           plan = ?, open_threads = ?, constraints = ?, deadline = ?, updated_at = ?
         WHERE id = ?`,
        [
          patch.type ?? current.type, patch.name ?? current.name, patch.description ?? current.description,
          patch.status ?? current.status, patch.horizon ?? current.horizon,
          patch.priority ?? current.priority, patch.urgency ?? current.urgency,
          toJson(patch.plan ?? current.plan), toJson(patch.openThreads ?? current.openThreads),
          toJson(patch.constraints ?? current.constraints), deadline, this.clock().toISOString(), id,
        ],
      )
      return this.require(id)
    }))
  }

  remove(id: IntentId): boolean {
    return this.db.run('DELETE FROM intents WHERE id = ?', [id]).changes > 0
  }

  private require(id: IntentId): CharacterIntent {
    const intent = this.get(id)
    if (intent === undefined) throw new NotFoundError(`intent ${id} does not exist`)
    return intent
  }
}
