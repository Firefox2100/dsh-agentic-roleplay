import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { InvalidEditError, InvalidValueError, NotFoundError, lintWorld, parseRecordsEdit, recordsEditSchema, type RecordsEdit, type SessionStore } from '../src/index.ts'
import { memoryStore, newCharacter } from './helpers.ts'

let store: SessionStore
const idOf = (key: string) => store.characters.getBySourceId(key)!.id
const problemsOf = (change: RecordsEdit): string[] => {
  try { store.edit(change) } catch (error) { if (error instanceof InvalidEditError) return [...error.problems]; throw error }
  return []
}
const mira = { key: 'mira', name: 'Mira Voss', summary: 'A ferry pilot.', place: { location: 'dock' } }

/** A town with a dock and a bar joined by a lane, Alice (the player) and Bob in the bar. */
beforeEach(() => {
  store = memoryStore()
  store.characters.add(newCharacter({ sourceId: 'alice', name: 'Alice', aliases: [], control: 'player' }))
  store.characters.add(newCharacter({ sourceId: 'bob', name: 'Bob', aliases: ['Bobby'] }))
  store.edit({
    turn: 1,
    places: [{ key: 'bar', name: 'The Bar' }, { key: 'lane', name: 'Lane', exits: [{ to: 'bar' }] }, { key: 'dock', name: 'The Dock', exits: [{ to: 'lane' }] }],
    moves: [{ character: 'alice', to: 'bar', ignoreExits: true }, { character: 'bob', to: 'bar', ignoreExits: true }],
  })
  for (const item of store.consolidation.pending()) store.consolidation.resolve(item.id, 1, 'part of the world')
})
afterEach(() => { store.close() })

describe('relationships', () => {
  it('are one profile per direction, made with a label and changed by what is given', () => {
    const made = store.relationships.upsert(idOf('alice'), idOf('bob'), { label: 'rival', summary: 'They fell out over the inn.', trust: -0.4, tension: 0.6 }, 2)
    expect(made).toMatchObject({ label: 'rival', trust: -0.4, tension: 0.6, familiarity: 0, affinity: 0, updatedTurn: 2 })
    const changed = store.relationships.upsert(idOf('alice'), idOf('bob'), { tension: 0.2, familiarity: 0.7 }, 5)
    expect(changed).toMatchObject({ id: made.id, label: 'rival', trust: -0.4, tension: 0.2, familiarity: 0.7, updatedTurn: 5 })
    expect(store.relationships.get(idOf('bob'), idOf('alice'))).toBeUndefined()
    expect(store.relationships.from(idOf('alice'))).toHaveLength(1)
    expect(store.relationships.to(idOf('bob'))).toHaveLength(1)
    expect(store.relationships.remove(idOf('alice'), idOf('bob'))).toBe(true)
    expect(store.relationships.list()).toEqual([])
  })

  it('refuse a new one without a label, one towards itself, values out of range, and a character that is not there', () => {
    expect(() => store.relationships.upsert(idOf('alice'), idOf('bob'), { trust: 0.5 }, 1)).toThrow(/needs a label/)
    expect(() => store.relationships.upsert(idOf('alice'), idOf('alice'), { label: 'self' }, 1)).toThrow(InvalidValueError)
    expect(() => store.relationships.upsert(idOf('alice'), idOf('bob'), { label: 'x', trust: 2 }, 1)).toThrow(/trust must be a number from -1 to 1/)
    expect(() => store.relationships.upsert(idOf('alice'), idOf('bob'), { label: ' ' }, 1)).toThrow(/needs a label/)
    expect(() => store.relationships.upsert(idOf('alice'), 999, { label: 'x' }, 1)).toThrow(NotFoundError)
  })

  it('are set through the edit by character keys, in both directions as two profiles, and shown in the records', () => {
    store.edit({ turn: 3, relationships: [{ from: 'alice', to: 'bob', label: 'innkeeper', familiarity: 0.5 }, { from: 'bob', to: 'alice', label: 'regular', affinity: 0.3 }] })
    expect(store.records().relationships.map(entry => [entry.from, entry.to, entry.label, entry.updated_turn])).toEqual([['bob', 'alice', 'regular', 3], ['alice', 'bob', 'innkeeper', 3]])
    store.edit({ turn: 4, relationships: [{ from: 'alice', to: 'bob', trust: 0.9 }] })
    expect(store.relationships.get(idOf('alice'), idOf('bob'))).toMatchObject({ label: 'innkeeper', trust: 0.9, updatedTurn: 4 })
    store.edit({ turn: 5, relationshipRetractions: [{ from: 'bob', to: 'alice' }] })
    expect(store.relationships.get(idOf('bob'), idOf('alice'))).toBeUndefined()
  })

  it('are checked as a whole by the edit, naming each problem', () => {
    const problems = problemsOf({
      turn: 2,
      relationships: [{ from: 'alice', to: 'alice', label: 'x' }, { from: 'alice', to: 'bob' }, { from: 'ghost', to: 'bob', label: 'x' }, { from: 'bob', to: 'alice', label: 'x', tension: 3 }],
      relationshipRetractions: [{ from: 'bob', to: 'alice' }],
    })
    expect(problems.join('\n')).toMatch(/relationships\[0\]: a character has no relationship with itself/)
    expect(problems.join('\n')).toMatch(/relationships\[1\]: a new relationship needs a label/)
    expect(problems.join('\n')).toMatch(/there is no character "ghost"/)
    expect(problems.join('\n')).toMatch(/relationships\[3\]: tension must be a number from 0 to 1/)
    expect(problems.join('\n')).toMatch(/relationship_retractions\[0\]: "bob" has no relationship with "alice"/)
    expect(store.relationships.list()).toEqual([])
  })
})

describe('making up characters', () => {
  it('creates the character with its state and place, played by an agent, and queues it to be fitted into the world', () => {
    const result = store.edit({
      turn: 4,
      characters: [{ ...mira, aliases: ['the pilot'], tier: 'supporting', personality: 'Dry.', speech: { style: 'Short sentences.', examples: ['Tide waits for no one.'] }, state: { publicState: 'Tying up the ferry.', activity: 'mooring' }, note: 'arrives with the news' }],
    })
    expect(result.characterKeys).toEqual(['mira'])
    const created = store.characters.getBySourceId('mira')!
    expect(created).toMatchObject({ name: 'Mira Voss', aliases: ['the pilot'], role: 'npc', control: 'agent', tier: 'supporting', kind: 'person', personality: 'Dry.', speech: { style: 'Short sentences.', examples: ['Tide waits for no one.'] } })
    expect(store.characterStates.get(created.id)).toMatchObject({ publicState: 'Tying up the ferry.', activity: 'mooring' })
    expect(store.placements.get('character', created.id)?.locationId).toBe(store.locations.getBySourceId('dock')!.id)
    expect(store.consolidation.pending()).toEqual([expect.objectContaining({ kind: 'character', subjectId: created.id, createdTurn: 4, note: 'arrives with the news' })])
  })

  it('lets the rest of the same edit name the new character: a relationship, an event, a move', () => {
    store.edit({
      turn: 4,
      characters: [mira],
      relationships: [{ from: 'mira', to: 'alice', label: 'passenger', summary: 'Carried her here.' }, { from: 'alice', to: 'mira', label: 'ferry pilot' }],
      events: [{ turn: 4, round: 1, text: 'Mira docked the ferry.', importance: 2, location: 'dock', involves: ['mira'], perceivedBy: [{ character: 'mira', mode: 'witnessed' }] }],
      moves: [{ character: 'mira', to: 'lane' }],
    })
    expect(store.relationships.from(idOf('mira')).map(relation => relation.label)).toEqual(['passenger'])
    expect(store.placements.get('character', idOf('mira'))?.locationId).toBe(store.locations.getBySourceId('lane')!.id)
    expect(store.events.list()[0]?.involves).toEqual([idOf('mira')])
  })

  it('can place a new character in a place made in the same edit', () => {
    store.edit({ turn: 4, places: [{ key: 'ferry', name: 'The Ferry', exits: [{ to: 'dock' }] }], characters: [{ ...mira, place: { location: 'ferry' } }] })
    expect(store.placements.get('character', idOf('mira'))?.locationId).toBe(store.locations.getBySourceId('ferry')!.id)
    expect(store.consolidation.pending().map(item => item.kind).sort()).toEqual(['character', 'location'])
  })

  it('refuses someone who already exists, by name or alias, including within the same edit, and names the key to reuse', () => {
    const problems = problemsOf({ turn: 4, characters: [{ key: 'robert', name: 'Robert', summary: 'x', aliases: ['bobby'] }, { key: 'bobby2', name: ' BOB ', summary: 'x' }, { key: 'twin1', name: 'Twin', summary: 'x' }, { key: 'twin2', name: 'twin', summary: 'x' }] })
    expect(problems.join('\n')).toMatch(/characters\[0\]: "bobby" is already the name of a character: reuse that one/)
    expect(problems.join('\n')).toMatch(/characters\[1\]: " BOB " is already the name of a character/)
    expect(problems.join('\n')).toMatch(/characters\[3\]: "twin" is already the name of a character/)
    expect(store.characters.list()).toHaveLength(2)
  })

  it('refuses a missing key, name or summary, a taken key, an unknown place or feature, and writes nothing from the rest of the edit', () => {
    const problems = problemsOf({
      turn: 4,
      characters: [{ key: 'bad key', name: '', summary: '' }, { key: 'alice', name: 'Another', summary: 'x' }, { key: 'lost', name: 'Lost', summary: 'x', place: { location: 'moon' } }, { key: 'odd', name: 'Odd', summary: 'x', place: { location: 'bar', feature: 'piano' } }],
      threadsOpened: ['must not be written'],
    })
    expect(problems.join('\n')).toMatch(/characters\[0\]: give the character a key/)
    expect(problems.join('\n')).toMatch(/characters\[0\]: give the character a name/)
    expect(problems.join('\n')).toMatch(/characters\[0\]: give the character a summary/)
    expect(problems.join('\n')).toMatch(/characters\[1\]: the key "alice" is already used/)
    expect(problems.join('\n')).toMatch(/characters\[2\]\.place: there is no place "moon"/)
    expect(problems.join('\n')).toMatch(/characters\[3\]\.place: The Bar has no feature "piano"/)
    expect(store.threads.list('open')).toEqual([])
  })

  it('rolls everything back when the rest of the edit is wrong, so no half-made character is left', () => {
    const problems = problemsOf({ turn: 4, places: [{ key: 'ferry', name: 'The Ferry' }], characters: [mira], relationships: [{ from: 'mira', to: 'nobody', label: 'x' }] })
    expect(problems.join('\n')).toMatch(/there is no character "nobody"/)
    expect(store.characters.getBySourceId('mira')).toBeUndefined()
    expect(store.locations.getBySourceId('ferry')).toBeUndefined()
    expect(store.consolidation.pending()).toEqual([])
  })

  it('is only offered to the agent whose work it is: the schema has characters, places and ways only for authoring', () => {
    expect(Object.keys(recordsEditSchema().properties ?? {})).not.toEqual(expect.arrayContaining(['characters']))
    expect(Object.keys(recordsEditSchema({ authoring: true }).properties ?? {})).toEqual(expect.arrayContaining(['characters', 'places', 'exits', 'relationships']))
    const parsed = parseRecordsEdit({
      turn: 4,
      characters: [{ key: 'mira', name: 'Mira', summary: 's', aliases: ['m'], speech: { style: 'x', examples: ['y'] }, state: { public_state: 'p' }, place: { location: 'dock', position: 'pier' }, note: 'n' }],
      exits: [{ from: 'dock', to: 'bar', one_way: true, travel_time_seconds: 9 }],
      relationships: [{ from: 'mira', to: 'alice', label: 'l', trust: 0.2 }],
      relationship_retractions: [{ from: 'a', to: 'b' }],
    })
    expect(parsed.characters).toEqual([{ key: 'mira', name: 'Mira', summary: 's', aliases: ['m'], speech: { style: 'x', examples: ['y'] }, state: { publicState: 'p' }, place: { location: 'dock', position: 'pier' }, note: 'n' }])
    expect(parsed.exits).toEqual([{ from: 'dock', to: 'bar', oneWay: true, travelSeconds: 9 }])
    expect(parsed.relationships).toEqual([{ from: 'mira', to: 'alice', label: 'l', trust: 0.2 }])
    expect(parsed.relationshipRetractions).toEqual([{ from: 'a', to: 'b' }])
  })
})

describe('making up places and ways', () => {
  it('queues a made-up place, and adds a way between places that exist, both ways unless one way', () => {
    store.edit({ turn: 5, places: [{ key: 'cellar', name: 'Cellar', parent: 'bar', note: 'under the floorboard' }], exits: [{ from: 'cellar', to: 'bar', description: 'a hatch' }, { from: 'cellar', to: 'lane', oneWay: true }] })
    const cellar = store.locations.getBySourceId('cellar')!
    expect(store.locations.getExit(cellar.id, store.locations.getBySourceId('bar')!.id)?.description).toBe('a hatch')
    expect(store.locations.getExit(store.locations.getBySourceId('bar')!.id, cellar.id)?.description).toBe('a hatch')
    expect(store.locations.getExit(store.locations.getBySourceId('lane')!.id, cellar.id)).toBeUndefined()
    expect(store.consolidation.pending()).toEqual([expect.objectContaining({ kind: 'location', subjectId: cellar.id, note: 'under the floorboard', createdTurn: 5 })])
  })

  it('refuses a way to a place that does not exist, to itself, or a one-way duplicate', () => {
    const problems = problemsOf({ turn: 5, exits: [{ from: 'bar', to: 'ghost' }, { from: 'bar', to: 'bar' }, { from: 'lane', to: 'bar', oneWay: true }] })
    expect(problems.join('\n')).toMatch(/exits\[0\]\.to: there is no place "ghost"/)
    expect(problems.join('\n')).toMatch(/exits\[1\]: an exit must lead to another place/)
    expect(problems.join('\n')).toMatch(/exits\[2\]: there already is an exit from "lane" to "bar"/)
  })
})

describe('what was made up and not yet fitted in', () => {
  it('is listed oldest first, counted by the turn it was made in, and resolved once with what was done', () => {
    store.edit({ turn: 4, characters: [mira] })
    store.edit({ turn: 4, places: [{ key: 'ferry', name: 'The Ferry' }] })
    store.edit({ turn: 6, characters: [{ key: 'tom', name: 'Tom', summary: 'x', place: { location: 'bar' } }] })
    const pending = store.consolidation.pending()
    expect(pending.map(item => [item.kind, item.createdTurn])).toEqual([['character', 4], ['location', 4], ['character', 6]])
    expect(store.consolidation.createdIn(4)).toHaveLength(2)
    expect(store.consolidation.resolve(pending[0]!.id, 7, 'joined the ferry crew').resolution).toBe('joined the ferry crew')
    expect(store.consolidation.resolve(pending[0]!.id, 9, 'again').resolvedTurn).toBe(7)
    expect(store.consolidation.pending()).toHaveLength(2)
    expect(() => store.consolidation.resolve(999, 1, 'x')).toThrow(NotFoundError)
  })
})

describe('what is inconsistent in the world', () => {
  const codes = (severity?: string) => lintWorld(store).filter(finding => severity === undefined || finding.severity === severity).map(finding => [finding.code, finding.subject.key])

  it('has nothing to say about a world that hangs together', () => {
    expect(codes('error')).toEqual([])
    expect(codes('warning')).toEqual([])
  })

  it('holds what was made up to a stricter standard: no way in or out, or in no place, is an error', () => {
    store.edit({ turn: 4, places: [{ key: 'attic', name: 'Attic' }], characters: [{ key: 'tom', name: 'Tom', summary: 'x' }] })
    expect(codes('error')).toEqual([['location-no-exit', 'attic'], ['character-unplaced', 'tom']])
    expect(codes('warning')).toEqual([['character-no-relationships', 'tom']])
    store.edit({ turn: 4, exits: [{ from: 'attic', to: 'bar' }], moves: [{ character: 'tom', to: 'attic', ignoreExits: true }], relationships: [{ from: 'tom', to: 'alice', label: 'lodger' }] })
    expect(codes('error')).toEqual([])
    expect(codes('warning')).toEqual([])
  })

  it('warns about a place no chain of exits reaches from where the player is, a place nobody can leave on the old world, and tells of ways with no way back', () => {
    store.edit({ turn: 4, places: [{ key: 'island', name: 'Island', exits: [{ to: 'pier', oneWay: true }] }, { key: 'pier', name: 'Pier' }] })
    expect(codes('warning')).toEqual(expect.arrayContaining([['location-unreachable', 'island']]))
    store.edit({ turn: 4, places: [{ key: 'shed', name: 'Shed', exits: [{ to: 'bar', oneWay: true }] }] })
    expect(codes('info')).toEqual(expect.arrayContaining([['exit-no-way-back', 'shed->bar']]))
  })

  it('does not ask a region that only contains places to have exits of its own', () => {
    store.edit({ turn: 4, places: [{ key: 'town', name: 'Town' }] })
    store.locations.update(store.locations.getBySourceId('bar')!.id, {})
    store.edit({ turn: 4, places: [{ key: 'yard', name: 'Yard', parent: 'town', exits: [{ to: 'bar' }] }] })
    expect(codes().filter(([code, key]) => code === 'location-no-exit' && key === 'town')).toEqual([])
  })

  it('finds two characters with the same name, and one-sided profiles as information', () => {
    store.characters.add(newCharacter({ sourceId: 'bob2', name: 'Bob', aliases: [] }))
    store.relationships.upsert(idOf('alice'), idOf('bob'), { label: 'friend' }, 2)
    expect(codes('error')).toEqual([['duplicate-name', 'bob2']])
    expect(codes('info')).toEqual([['relationship-one-sided', 'alice->bob']])
    expect(lintWorld(store).map(finding => finding.severity)).toEqual(['error', 'warning', 'info'])
  })
})
