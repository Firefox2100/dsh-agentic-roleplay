import type { Character, CharacterControl, CharacterFilter, CharacterId, CharacterPatch, NewCharacter } from 'dsh-roleplay-model'
import type { Clock } from '../clock.ts'
import type { SqlDatabase, SqlValue } from '../driver/types.ts'
import { InvalidValueError, NotFoundError } from '../errors.ts'
import type { CharacterRepository } from '../repositories.ts'
import { guard, lookupKey, parseStringList, toJson } from './support.ts'

interface CharacterRow {
  id: number
  source_id: string | null
  name: string
  age: string | null
  gender: string | null
  pronouns: string | null
  kind: Character['kind']
  tier: Character['tier']
  role: Character['role']
  control: CharacterControl
  summary: string
  personality: string
  background: string
  appearance: string
  speech_style: string
  speech_examples: string
  voice: string | null
  created_at: string
}

interface AliasRow {
  character_id: number
  alias: string
}

function toCharacter(row: CharacterRow, aliases: string[]): Character {
  return {
    id: row.id,
    ...(row.source_id === null ? {} : { sourceId: row.source_id }),
    name: row.name,
    aliases,
    ...(row.age === null ? {} : { age: row.age }),
    ...(row.gender === null ? {} : { gender: row.gender }),
    ...(row.pronouns === null ? {} : { pronouns: row.pronouns }),
    kind: row.kind,
    tier: row.tier,
    role: row.role,
    control: row.control,
    summary: row.summary,
    personality: row.personality,
    background: row.background,
    appearance: row.appearance,
    speech: { style: row.speech_style, examples: parseStringList(row.speech_examples, 'characters.speech_examples') },
    ...(row.voice === null ? {} : { voice: row.voice }),
    createdAt: row.created_at,
  }
}

export class SqliteCharacterRepository implements CharacterRepository {
  constructor(private readonly db: SqlDatabase, private readonly clock: Clock) {}

  add(character: NewCharacter): Character {
    return guard(() => this.db.transaction(() => {
      const { lastInsertRowid: id } = this.db.run(
        `INSERT INTO characters (
           source_id, name, name_key, age, gender, pronouns, kind, tier, role, control,
           summary, personality, background, appearance, speech_style, speech_examples, voice, created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          character.sourceId ?? null, character.name, lookupKey(character.name),
          character.age ?? null, character.gender ?? null, character.pronouns ?? null,
          character.kind, character.tier, character.role, character.control,
          character.summary, character.personality, character.background, character.appearance,
          character.speech.style, toJson(character.speech.examples), character.voice ?? null, this.clock().toISOString(),
        ],
      )
      const stored = new Set<string>()
      for (const alias of character.aliases) {
        const key = lookupKey(alias)
        if (stored.has(key)) continue
        this.db.run(
          'INSERT INTO character_aliases (character_id, position, alias, alias_key) VALUES (?, ?, ?, ?)',
          [id, stored.size, alias, key],
        )
        stored.add(key)
      }
      return this.require(id)
    }))
  }

  get(id: CharacterId): Character | undefined {
    return this.read('WHERE id = ?', [id])[0]
  }

  getBySourceId(sourceId: string): Character | undefined {
    return this.read('WHERE source_id = ?', [sourceId])[0]
  }

  list(filter: CharacterFilter = {}): Character[] {
    const conditions: string[] = []
    const params: SqlValue[] = []
    for (const column of ['role', 'tier', 'kind', 'control'] as const) {
      const value = filter[column]
      if (value === undefined) continue
      conditions.push(`${column} = ?`)
      params.push(value)
    }
    return this.read(conditions.length === 0 ? '' : `WHERE ${conditions.join(' AND ')}`, params)
  }

  findByName(name: string): Character[] {
    const key = lookupKey(name)
    return this.read(
      'WHERE name_key = ?1 OR id IN (SELECT character_id FROM character_aliases WHERE alias_key = ?1)',
      [key],
    )
  }

  setControl(id: CharacterId, control: CharacterControl): Character {
    return guard(() => this.db.transaction(() => {
      if (this.db.run('UPDATE characters SET control = ? WHERE id = ?', [control, id]).changes === 0) {
        throw new NotFoundError(`character ${id} does not exist`)
      }
      return this.require(id)
    }))
  }

  update(id: CharacterId, patch: CharacterPatch): Character {
    return guard(() => this.db.transaction(() => {
      const current = this.require(id)
      const next: Character = {
        ...current,
        ...(patch.name === undefined ? {} : { name: patch.name.trim() }),
        ...(patch.aliases === undefined ? {} : { aliases: patch.aliases }),
        ...(patch.kind === undefined ? {} : { kind: patch.kind }),
        ...(patch.tier === undefined ? {} : { tier: patch.tier }),
        ...(patch.role === undefined ? {} : { role: patch.role }),
        ...(patch.summary === undefined ? {} : { summary: patch.summary }),
        ...(patch.personality === undefined ? {} : { personality: patch.personality }),
        ...(patch.background === undefined ? {} : { background: patch.background }),
        ...(patch.appearance === undefined ? {} : { appearance: patch.appearance }),
        ...(patch.speech === undefined ? {} : { speech: patch.speech }),
      }
      if (patch.voice !== undefined) { if (patch.voice === null || patch.voice.trim() === '') delete next.voice; else next.voice = patch.voice.trim() }
      for (const field of ['age', 'gender', 'pronouns'] as const) {
        const value = patch[field]
        if (value === undefined) continue
        const text = value?.trim()
        if (text === undefined || text === '') delete next[field]
        else next[field] = text
      }
      if (next.name === '') throw new InvalidValueError('a character needs a name')
      if (next.role === 'playable' && (next.kind === 'group' || next.tier === 'background')) throw new InvalidValueError('a playable character cannot be a group or a background character')
      this.db.run(
        `UPDATE characters SET name = ?, name_key = ?, age = ?, gender = ?, pronouns = ?, kind = ?, tier = ?, role = ?, summary = ?, personality = ?, background = ?, appearance = ?, speech_style = ?, speech_examples = ?, voice = ? WHERE id = ?`,
        [next.name, lookupKey(next.name), next.age ?? null, next.gender ?? null, next.pronouns ?? null, next.kind, next.tier, next.role, next.summary, next.personality, next.background, next.appearance, next.speech.style, toJson(next.speech.examples), next.voice ?? null, id],
      )
      if (patch.aliases !== undefined) {
        this.db.run('DELETE FROM character_aliases WHERE character_id = ?', [id])
        const stored = new Set<string>()
        for (const alias of patch.aliases.map(entry => entry.trim()).filter(entry => entry !== '')) {
          const key = lookupKey(alias)
          if (stored.has(key)) continue
          this.db.run('INSERT INTO character_aliases (character_id, position, alias, alias_key) VALUES (?, ?, ?, ?)', [id, stored.size, alias, key])
          stored.add(key)
        }
      }
      return this.require(id)
    }))
  }

  private require(id: CharacterId): Character {
    const character = this.get(id)
    if (character === undefined) throw new NotFoundError(`character ${id} does not exist`)
    return character
  }

  private read(where: string, params: readonly SqlValue[]): Character[] {
    const rows = this.db.all<CharacterRow>(`SELECT * FROM characters ${where} ORDER BY id`, params)
    if (rows.length === 0) return []
    const aliases = new Map<number, string[]>()
    for (const row of this.db.all<AliasRow>(
      `SELECT character_id, alias FROM character_aliases
       WHERE character_id IN (SELECT id FROM characters ${where}) ORDER BY character_id, position`,
      params,
    )) {
      aliases.set(row.character_id, [...aliases.get(row.character_id) ?? [], row.alias])
    }
    return rows.map(row => toCharacter(row, aliases.get(row.id) ?? []))
  }
}
