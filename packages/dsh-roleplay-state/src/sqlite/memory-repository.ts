import type { CharacterMemory, CharacterMemoryPatch, MemoryId, NewCharacterMemory } from 'dsh-roleplay-model'
import type { Clock } from '../clock.ts'
import type { SqlDatabase } from '../driver/types.ts'
import { NotFoundError } from '../errors.ts'
import type { MemoryRepository } from '../repositories.ts'
import type { IndexWrites } from './event-repository.ts'
import { guard, parseNumberList, toJson } from './support.ts'

interface MemoryRow {
  id: number
  character_id: number
  kind: CharacterMemory['kind']
  text: string
  about: string
  importance: number
  turn: number
  recalls: number
  last_recalled_turn: number | null
  created_at: string
}

const toMemory = (row: MemoryRow): CharacterMemory => ({
  id: row.id,
  characterId: row.character_id,
  kind: row.kind,
  text: row.text,
  about: parseNumberList(row.about, 'memories.about'),
  importance: row.importance,
  turn: row.turn,
  recalls: row.recalls,
  ...(row.last_recalled_turn === null ? {} : { lastRecalledTurn: row.last_recalled_turn }),
  createdAt: row.created_at,
})

export class SqliteMemoryRepository implements MemoryRepository {
  constructor(private readonly db: SqlDatabase, private readonly clock: Clock, private readonly index: IndexWrites) {}

  add(memory: NewCharacterMemory): CharacterMemory {
    return guard(() => {
      const { lastInsertRowid } = this.db.run(
        'INSERT INTO memories (character_id, kind, text, about, importance, turn, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [memory.characterId, memory.kind, memory.text, toJson(memory.about), memory.importance, memory.turn, this.clock().toISOString()],
      )
      const added = this.require(Number(lastInsertRowid))
      this.index.put({ kind: 'memory', refId: added.id, characterId: added.characterId, text: added.text })
      return added
    })
  }

  get(id: MemoryId): CharacterMemory | undefined {
    const row = this.db.get<MemoryRow>('SELECT * FROM memories WHERE id = ?', [id])
    return row === undefined ? undefined : toMemory(row)
  }

  list(characterId: number): CharacterMemory[] {
    return this.db.all<MemoryRow>('SELECT * FROM memories WHERE character_id = ? ORDER BY id', [characterId]).map(toMemory)
  }

  update(id: MemoryId, patch: CharacterMemoryPatch): CharacterMemory {
    return guard(() => {
      const current = this.require(id)
      this.db.run('UPDATE memories SET text = ?, about = ?, importance = ? WHERE id = ?', [
        patch.text ?? current.text, toJson(patch.about ?? current.about), patch.importance ?? current.importance, id,
      ])
      const changed = this.require(id)
      this.index.put({ kind: 'memory', refId: id, characterId: changed.characterId, text: changed.text })
      return changed
    })
  }

  touch(ids: readonly MemoryId[], turn: number): void {
    this.db.transaction(() => {
      for (const id of ids) this.db.run('UPDATE memories SET recalls = recalls + 1, last_recalled_turn = ? WHERE id = ?', [turn, id])
    })
  }

  remove(id: MemoryId): boolean {
    this.index.remove('memory', id)
    return this.db.run('DELETE FROM memories WHERE id = ?', [id]).changes > 0
  }

  private require(id: MemoryId): CharacterMemory {
    const memory = this.get(id)
    if (memory === undefined) throw new NotFoundError(`memory ${id} does not exist`)
    return memory
  }
}
