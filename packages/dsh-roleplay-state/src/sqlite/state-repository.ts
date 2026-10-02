import type { CharacterId, CharacterState, CharacterStatePatch, EmotionStart, NewCharacterState } from 'dsh-roleplay-model'
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
  baseline_valence: number | null
  baseline_arousal: number | null
  baseline_dominance: number | null
  immediate_valence: number | null
  immediate_arousal: number | null
  immediate_dominance: number | null
}

function toState(row: StateRow): CharacterState {
  const emotion = row.baseline_valence === null ? undefined : {
    baseline: { valence: row.baseline_valence, arousal: row.baseline_arousal ?? 0, dominance: row.baseline_dominance ?? 0 },
    immediate: { valence: row.immediate_valence ?? 0, arousal: row.immediate_arousal ?? 0, dominance: row.immediate_dominance ?? 0 },
  }
  return {
    characterId: row.character_id,
    publicState: row.public_state,
    innerState: row.inner_state,
    activity: row.activity,
    ...(emotion === undefined ? {} : { emotion }),
    version: row.version,
    updatedAt: row.updated_at,
  }
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
      if (state.emotion !== undefined) this.writeEmotion(characterId, state.emotion)
      return this.require(characterId)
    }))
  }

  get(characterId: CharacterId): CharacterState | undefined {
    const row = this.db.get<StateRow>(
      `SELECT s.*, e.baseline_valence, e.baseline_arousal, e.baseline_dominance,
              e.immediate_valence, e.immediate_arousal, e.immediate_dominance
       FROM character_state s LEFT JOIN character_emotion e ON e.character_id = s.character_id
       WHERE s.character_id = ?`,
      [characterId],
    )
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
      if (patch.emotion === null) this.db.run('DELETE FROM character_emotion WHERE character_id = ?', [characterId])
      else if (patch.emotion !== undefined) this.writeEmotion(characterId, patch.emotion)
      return this.require(characterId)
    }))
  }

  private require(characterId: CharacterId): CharacterState {
    const state = this.get(characterId)
    if (state === undefined) throw new NotFoundError(`character ${characterId} has no state`)
    return state
  }

  private writeEmotion(characterId: CharacterId, { baseline, immediate }: EmotionStart): void {
    this.db.run(
      `INSERT INTO character_emotion (
         character_id, baseline_valence, baseline_arousal, baseline_dominance,
         immediate_valence, immediate_arousal, immediate_dominance
       ) VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (character_id) DO UPDATE SET
         baseline_valence = excluded.baseline_valence, baseline_arousal = excluded.baseline_arousal,
         baseline_dominance = excluded.baseline_dominance, immediate_valence = excluded.immediate_valence,
         immediate_arousal = excluded.immediate_arousal, immediate_dominance = excluded.immediate_dominance`,
      [
        characterId, baseline.valence, baseline.arousal, baseline.dominance,
        immediate.valence, immediate.arousal, immediate.dominance,
      ],
    )
  }
}
