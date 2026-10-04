import type { CharacterId, ConsolidationItem, ConsolidationItemId, ConsolidationKind, Relationship, RelationshipPatch } from 'dsh-roleplay-model'
import type { Clock } from '../clock.ts'
import type { SqlDatabase } from '../driver/types.ts'
import { InvalidValueError, NotFoundError } from '../errors.ts'
import type { ConsolidationRepository, RelationshipRepository } from '../repositories.ts'
import { guard } from './support.ts'

interface RelationshipRow {
  id: number
  from_id: number
  to_id: number
  label: string
  summary: string
  familiarity: number
  trust: number
  affinity: number
  tension: number
  updated_turn: number
  created_at: string
}

interface ItemRow {
  id: number
  kind: ConsolidationKind
  subject_id: number
  note: string
  created_turn: number
  resolved_turn: number | null
  resolution: string | null
}

const toRelationship = (row: RelationshipRow): Relationship => ({
  id: row.id, fromId: row.from_id, toId: row.to_id, label: row.label, summary: row.summary,
  familiarity: row.familiarity, trust: row.trust, affinity: row.affinity, tension: row.tension,
  updatedTurn: row.updated_turn, createdAt: row.created_at,
})

const toItem = (row: ItemRow): ConsolidationItem => ({
  id: row.id, kind: row.kind, subjectId: row.subject_id, note: row.note, createdTurn: row.created_turn,
  ...(row.resolved_turn === null ? {} : { resolvedTurn: row.resolved_turn }),
  ...(row.resolution === null ? {} : { resolution: row.resolution }),
})

const RANGES = { familiarity: [0, 1], trust: [-1, 1], affinity: [-1, 1], tension: [0, 1] } as const

function checked(patch: RelationshipPatch): void {
  for (const [key, [min, max]] of Object.entries(RANGES) as [keyof typeof RANGES, readonly [number, number]][]) {
    const value = patch[key]
    if (value !== undefined && (!Number.isFinite(value) || value < min || value > max)) throw new InvalidValueError(`${key} must be a number from ${min} to ${max}`)
  }
  if (patch.label !== undefined && patch.label.trim() === '') throw new InvalidValueError('a relationship needs a label')
}

export class SqliteRelationshipRepository implements RelationshipRepository {
  constructor(private readonly db: SqlDatabase, private readonly clock: Clock) {}

  upsert(fromId: CharacterId, toId: CharacterId, patch: RelationshipPatch, turn: number): Relationship {
    if (fromId === toId) throw new InvalidValueError('a character has no relationship with itself')
    checked(patch)
    return guard(() => this.db.transaction(() => {
      const current = this.get(fromId, toId)
      if (current === undefined) {
        if (patch.label === undefined) throw new InvalidValueError('a new relationship needs a label')
        this.db.run(
          'INSERT INTO relationships (from_id, to_id, label, summary, familiarity, trust, affinity, tension, updated_turn, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
          [fromId, toId, patch.label.trim(), (patch.summary ?? '').trim(), patch.familiarity ?? 0, patch.trust ?? 0, patch.affinity ?? 0, patch.tension ?? 0, turn, this.clock().toISOString()],
        )
      } else {
        this.db.run('UPDATE relationships SET label = ?, summary = ?, familiarity = ?, trust = ?, affinity = ?, tension = ?, updated_turn = ? WHERE id = ?', [
          (patch.label ?? current.label).trim(), (patch.summary ?? current.summary).trim(), patch.familiarity ?? current.familiarity, patch.trust ?? current.trust,
          patch.affinity ?? current.affinity, patch.tension ?? current.tension, turn, current.id,
        ])
      }
      return this.get(fromId, toId)!
    }))
  }

  get(fromId: CharacterId, toId: CharacterId): Relationship | undefined {
    const row = this.db.get<RelationshipRow>('SELECT * FROM relationships WHERE from_id = ? AND to_id = ?', [fromId, toId])
    return row === undefined ? undefined : toRelationship(row)
  }

  from(characterId: CharacterId): Relationship[] {
    return this.db.all<RelationshipRow>('SELECT * FROM relationships WHERE from_id = ? ORDER BY id', [characterId]).map(toRelationship)
  }

  to(characterId: CharacterId): Relationship[] {
    return this.db.all<RelationshipRow>('SELECT * FROM relationships WHERE to_id = ? ORDER BY id', [characterId]).map(toRelationship)
  }

  list(): Relationship[] {
    return this.db.all<RelationshipRow>('SELECT * FROM relationships ORDER BY id').map(toRelationship)
  }

  remove(fromId: CharacterId, toId: CharacterId): boolean {
    return this.db.run('DELETE FROM relationships WHERE from_id = ? AND to_id = ?', [fromId, toId]).changes > 0
  }
}

export class SqliteConsolidationRepository implements ConsolidationRepository {
  constructor(private readonly db: SqlDatabase) {}

  enqueue(item: { kind: ConsolidationKind; subjectId: number; note: string; turn: number }): ConsolidationItem {
    const { lastInsertRowid } = this.db.run('INSERT INTO consolidation_items (kind, subject_id, note, created_turn) VALUES (?, ?, ?, ?)', [item.kind, item.subjectId, item.note.trim(), item.turn])
    return this.require(Number(lastInsertRowid))
  }

  get(id: ConsolidationItemId): ConsolidationItem | undefined {
    const row = this.db.get<ItemRow>('SELECT * FROM consolidation_items WHERE id = ?', [id])
    return row === undefined ? undefined : toItem(row)
  }

  pending(): ConsolidationItem[] {
    return this.db.all<ItemRow>('SELECT * FROM consolidation_items WHERE resolved_turn IS NULL ORDER BY id').map(toItem)
  }

  createdIn(turn: number): ConsolidationItem[] {
    return this.db.all<ItemRow>('SELECT * FROM consolidation_items WHERE created_turn = ? ORDER BY id', [turn]).map(toItem)
  }

  resolve(id: ConsolidationItemId, turn: number, resolution: string): ConsolidationItem {
    const current = this.require(id)
    if (current.resolvedTurn !== undefined) return current
    this.db.run('UPDATE consolidation_items SET resolved_turn = ?, resolution = ? WHERE id = ?', [turn, resolution.trim(), id])
    return this.require(id)
  }

  private require(id: ConsolidationItemId): ConsolidationItem {
    const found = this.get(id)
    if (found === undefined) throw new NotFoundError(`consolidation item ${id} does not exist`)
    return found
  }
}
