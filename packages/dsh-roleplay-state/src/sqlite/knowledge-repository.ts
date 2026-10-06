import type { CharacterId, EntityKnowledge, KnowledgeKind } from 'dsh-roleplay-model'
import type { SqlDatabase } from '../driver/types.ts'
import { NotFoundError } from '../errors.ts'
import type { KnowledgeRepository } from '../repositories.ts'

interface Row { character_id: number; subject_kind: KnowledgeKind; subject_id: number; learned_turn: number; last_observed_turn: number | null }

const fromRow = (row: Row): EntityKnowledge => ({
  characterId: row.character_id, subjectKind: row.subject_kind, subjectId: row.subject_id, learnedTurn: row.learned_turn,
  ...(row.last_observed_turn === null ? {} : { lastObservedTurn: row.last_observed_turn }),
})

export class SqliteKnowledgeRepository implements KnowledgeRepository {
  constructor(private readonly db: SqlDatabase) {}

  learn(characterId: CharacterId, subjectKind: KnowledgeKind, subjectId: number, turn: number, observed = false): EntityKnowledge {
    this.requireSubject(characterId, subjectKind, subjectId)
    this.db.run(`INSERT INTO entity_knowledge (character_id, subject_kind, subject_id, learned_turn, last_observed_turn)
      VALUES (?, ?, ?, ?, ?) ON CONFLICT (character_id, subject_kind, subject_id) DO UPDATE SET
      last_observed_turn = CASE WHEN excluded.last_observed_turn IS NULL THEN entity_knowledge.last_observed_turn ELSE excluded.last_observed_turn END`,
    [characterId, subjectKind, subjectId, turn, observed ? turn : null])
    return this.get(characterId, subjectKind, subjectId)!
  }

  knows(characterId: CharacterId, subjectKind: KnowledgeKind, subjectId: number): boolean {
    return this.get(characterId, subjectKind, subjectId) !== undefined
  }

  get(characterId: CharacterId, subjectKind: KnowledgeKind, subjectId: number): EntityKnowledge | undefined {
    const row = this.db.get<Row>('SELECT * FROM entity_knowledge WHERE character_id = ? AND subject_kind = ? AND subject_id = ?', [characterId, subjectKind, subjectId])
    return row === undefined ? undefined : fromRow(row)
  }

  list(characterId: CharacterId, subjectKind?: KnowledgeKind): EntityKnowledge[] {
    return this.db.all<Row>(`SELECT * FROM entity_knowledge WHERE character_id = ?${subjectKind === undefined ? '' : ' AND subject_kind = ?'} ORDER BY subject_kind, subject_id`, subjectKind === undefined ? [characterId] : [characterId, subjectKind]).map(fromRow)
  }

  forget(characterId: CharacterId, subjectKind: KnowledgeKind, subjectId: number): boolean {
    return this.db.run('DELETE FROM entity_knowledge WHERE character_id = ? AND subject_kind = ? AND subject_id = ?', [characterId, subjectKind, subjectId]).changes > 0
  }

  private requireSubject(characterId: CharacterId, kind: KnowledgeKind, id: number): void {
    if (this.db.get('SELECT id FROM characters WHERE id = ?', [characterId]) === undefined) throw new NotFoundError(`character ${characterId} does not exist`)
    const table = kind === 'location' ? 'locations' : kind === 'item' ? 'items' : 'exits'
    if (this.db.get(`SELECT id FROM ${table} WHERE id = ?`, [id]) === undefined) throw new NotFoundError(`${kind} ${id} does not exist`)
  }
}
