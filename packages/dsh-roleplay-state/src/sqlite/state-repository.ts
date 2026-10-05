import type { CharacterId, CharacterState, CharacterStatePatch, NewCharacterState } from 'dsh-roleplay-model'
import type { Clock } from '../clock.ts'
import type { SqlDatabase } from '../driver/types.ts'
import { ConflictError, NotFoundError } from '../errors.ts'
import type { CharacterStateRepository } from '../repositories.ts'
import { guard } from './support.ts'

interface StateRow {
  character_id: number
  public_state: string
  inner_state: string
  activity: string
  version: number
  updated_at: string
}

function toState(row: StateRow): CharacterState {
  return { characterId: row.character_id, publicState: row.public_state, innerState: row.inner_state, activity: row.activity, version: row.version, updatedAt: row.updated_at }
}

export class SqliteCharacterStateRepository implements CharacterStateRepository {
  constructor(private readonly db: SqlDatabase, private readonly clock: Clock) {}

  create(characterId: CharacterId, state: NewCharacterState): CharacterState {
    return guard(() => this.db.transaction(() => {
      if (this.db.get('SELECT 1 FROM characters WHERE id = ?', [characterId]) === undefined) {
        throw new NotFoundError(`character ${characterId} does not exist`)
      }
      this.db.run(
        'INSERT INTO character_state (character_id, public_state, inner_state, activity, updated_at) VALUES (?, ?, ?, ?, ?)',
        [characterId, state.publicState, state.innerState, state.activity, this.clock().toISOString()],
      )
      return this.require(characterId)
    }))
  }

  get(characterId: CharacterId): CharacterState | undefined {
    const row = this.db.get<StateRow>('SELECT * FROM character_state WHERE character_id = ?', [characterId])
    return row === undefined ? undefined : toState(row)
  }

  update(characterId: CharacterId, patch: CharacterStatePatch, options: { expectedVersion?: number } = {}): CharacterState {
    return guard(() => this.db.transaction(() => {
      const current = this.require(characterId)
      if (options.expectedVersion !== undefined && current.version !== options.expectedVersion) {
        throw new ConflictError(`the state of character ${characterId} is at version ${current.version}, not ${options.expectedVersion}`)
      }
      if (Object.keys(patch).length === 0) return current
      this.db.run(
        `UPDATE character_state
         SET public_state = ?, inner_state = ?, activity = ?, version = version + 1, updated_at = ?
         WHERE character_id = ?`,
        [
          patch.publicState ?? current.publicState,
          patch.innerState ?? current.innerState,
          patch.activity ?? current.activity,
          this.clock().toISOString(),
          characterId,
        ],
      )
      return this.require(characterId)
    }))
  }

  private require(characterId: CharacterId): CharacterState {
    const state = this.get(characterId)
    if (state === undefined) throw new NotFoundError(`character ${characterId} has no state`)
    return state
  }
}
