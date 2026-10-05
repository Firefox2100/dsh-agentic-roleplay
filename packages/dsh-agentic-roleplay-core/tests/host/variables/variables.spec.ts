import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createSessionStore, type SessionStore } from 'dsh-roleplay-state'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { parseCharacterFile } from '../../../src/host/characters/character-file.ts'
import { parseItemFile } from '../../../src/host/items/item-file.ts'
import { parseLocationFile } from '../../../src/host/locations/location-file.ts'
import { populateVariables } from '../../../src/host/sessions/populate.ts'
import { describeShown } from '../../../src/host/variables/describe.ts'
import { loadVariables, parseVariablesFile, variableProblems } from '../../../src/host/variables/load.ts'
import { parseWorldFile } from '../../../src/host/worlds/world-file.ts'

describe('initial values in a world\'s files', () => {
  it('are read from a character, an item, a place and the world, by variable key', () => {
    const character = parseCharacterFile(JSON.stringify({ name: 'Clara', variables: { health: 7, hurt: true, mood: 'wary' } }), 'clara')
    expect(character.ok && character.value.variables).toEqual({ health: 7, hurt: true, mood: 'wary' })
    const item = parseItemFile(JSON.stringify({ name: 'Lamp', location: 'bar', variables: { lit: true } }), 'lamp')
    expect(item.ok && item.value.variables).toEqual({ lit: true })
    const place = parseLocationFile(JSON.stringify({ name: 'Bar', variables: { stance: 'calm' } }), 'bar')
    expect(place.ok && place.value.variables).toEqual({ stance: 'calm' })
    const world = parseWorldFile(JSON.stringify({ name: 'W', variables: { alarm: false } }))
    expect(world.ok && world.value.variables).toEqual({ alarm: false })
    const none = parseCharacterFile(JSON.stringify({ name: 'Clara' }), 'clara')
    expect(none.ok && none.value.variables).toBeUndefined()
  })

  it('are reported with their path when they are not an object of numbers, flags and words, or too many', () => {
    const issues = (name: string, variables: unknown) => { const result = parseCharacterFile(JSON.stringify({ name, variables }), 'x'); return result.ok ? [] : result.issues.map(issue => issue.path) }
    expect(issues('A', [1])).toEqual(['variables'])
    expect(issues('A', { a: null, b: { c: 1 }, c: 'ok' })).toEqual(['variables.a', 'variables.b'])
    expect(issues('A', Object.fromEntries(Array.from({ length: 41 }, (_, index) => [`v${index}`, index])))).toEqual(['variables'])
  })
})

describe('variables.json', () => {
  it('declares what the world tracks: a kind, what it is about, bounds or words, a default, who can tell, and bands', () => {
    const parsed = parseVariablesFile(JSON.stringify([
      { key: 'health', name: 'Health', kind: 'number', subject: 'character', min: 0, max: 10, integer: true, default: 10, visibility: 'public', always: true, bands: [{ up_to: 3, label: 'hurt' }, { up_to: 10, label: 'well' }], description: 'How hurt.' },
      { key: 'door', name: 'Door', kind: 'choice', subject: 'item', options: ['shut', 'ajar'], only: ['lamp'] },
      { key: 'alarm', name: 'Alarm', kind: 'flag', subject: 'world', baseline: false },
    ]))
    expect(parsed).toEqual({ ok: true, value: [
      { key: 'health', name: 'Health', kind: 'number', subject: 'character', visibility: 'public', description: 'How hurt.', only: [], options: [], bands: [{ upTo: 3, label: 'hurt' }, { upTo: 10, label: 'well' }], min: 0, max: 10, integer: true, always: true, default: 10 },
      { key: 'door', name: 'Door', kind: 'choice', subject: 'item', visibility: 'public', only: ['lamp'], options: ['shut', 'ajar'], bands: [] },
      { key: 'alarm', name: 'Alarm', kind: 'flag', subject: 'world', visibility: 'public', only: [], options: [], bands: [], baseline: false },
    ] })
  })

  it('is reported with its path: not JSON, not a list, a missing key or name, an unknown kind, flags that are not flags, a default that is not a value', () => {
    expect(parseVariablesFile('{').ok).toBe(false)
    expect(parseVariablesFile('{}')).toEqual({ ok: false, issues: [{ path: '', message: 'expected a list of variables' }] })
    const result = parseVariablesFile(JSON.stringify([{ name: 'X' }, { key: 'x' }, { key: 'y', name: 'Y', kind: 'text', integer: 'yes', default: [1] }]))
    expect(result.ok ? [] : result.issues.map(issue => issue.path)).toEqual(['[0].key', '[1].name', '[2].kind', '[2].default', '[2].integer'])
  })

  describe('in a world folder', () => {
    let world: string
    beforeEach(async () => { world = await mkdtemp(join(tmpdir(), 'vars-')) })
    afterEach(async () => { await rm(world, { recursive: true, force: true }) })

    it('is read when there, nothing when not, and its problems are reported with the file', async () => {
      expect(await loadVariables(world)).toEqual({ defs: [], problems: [] })
      await mkdir(world, { recursive: true })
      await writeFile(join(world, 'variables.json'), JSON.stringify([{ key: 'alarm', name: 'Alarm', kind: 'flag', subject: 'world' }]))
      expect((await loadVariables(world)).defs.map(def => def.key)).toEqual(['alarm'])
      await writeFile(join(world, 'variables.json'), '[{"name":"X"}]')
      const bad = await loadVariables(world)
      expect(bad.problems).toEqual([{ path: join(world, 'variables.json'), message: '[0].key: is required' }])
    })
  })
})

describe('what a world tracks, before a session is made of it', () => {
  const character = (id: string, variables?: Record<string, number | boolean | string>) => ({ id, name: id, aliases: [], kind: 'person' as const, tier: 'principal' as const, role: 'npc' as const, summary: '', personality: '', background: '', appearance: '', speech: { style: '', examples: [] }, start: { publicState: '', innerState: '', activity: '', intents: [] }, ...(variables === undefined ? {} : { variables }) })
  const place = (id: string, variables?: Record<string, number | boolean | string>) => ({ id, name: id, description: '', features: [], exits: [], ...(variables === undefined ? {} : { variables }) })
  const defs = [
    { key: 'health', name: 'Health', kind: 'number' as const, subject: 'character' as const, min: 0, max: 10, integer: true, default: 10 },
    { key: 'rank', name: 'Rank', kind: 'number' as const, subject: 'character' as const, only: ['clara'], default: 1 },
    { key: 'stance', name: 'Stance', kind: 'choice' as const, subject: 'location' as const, options: ['calm', 'tense'] },
    { key: 'alarm', name: 'Alarm', kind: 'flag' as const, subject: 'world' as const },
  ]
  const problems = (extra: Partial<Parameters<typeof variableProblems>[0]> = {}) => variableProblems({ defs, characters: [character('clara'), character('bob')], items: [], locations: [place('bar')], values: undefined, ...extra })

  it('has none when everything is declared, applies to what it is given to, and holds a value it can have', () => {
    expect(problems({ characters: [character('clara', { health: 7, rank: 3 }), character('bob', { health: 1 })], locations: [place('bar', { stance: 'tense' })], values: { alarm: true } })).toEqual([])
  })

  it('names what is wrong: a declaration that cannot be one, one declared twice, a subject that does not exist, a value for what is not declared, for another kind of thing, for what it does not apply to, or out of its range', () => {
    expect(problems({ defs: [...defs, { key: 'health', name: 'Again', kind: 'flag', subject: 'item' }, { key: 'BAD', name: 'X', kind: 'flag', subject: 'world' }, { key: 'rooms', name: 'Rooms', kind: 'flag', subject: 'location', only: ['nowhere'] }] })).toEqual([
      'variables.json[4]: "health" is declared twice',
      'variables.json[5]: BAD: the key is lowercase letters, digits and underscores, starting with a letter, at most 40 characters',
      'variables.json: rooms: "nowhere" is not a location of this world',
    ])
    expect(problems({ characters: [character('clara'), character('bob', { mana: 1, stance: 'calm', rank: 2, health: 11 })] })).toEqual([
      'bob: character: variables.mana: no such variable is declared (variables.json)',
      'bob: character: variables.stance: Stance is about a location, not a character',
      'bob: character: variables.rank: Rank does not apply to it',
      'bob: character: variables.health: health is a number from 0 up to 10',
    ])
    expect(problems({ values: { alarm: 'yes', health: 1 } })).toEqual(['world.json: variables.alarm: alarm is a yes or no', 'world.json: variables.health: Health is about a character, not the world'])
  })

  describe('in a session', () => {
    let session: SessionStore
    beforeEach(() => {
      session = createSessionStore(':memory:', { id: 's', name: 'S', world: { id: 'w', name: 'W' } })
      session.characters.add({ aliases: [], kind: 'person', tier: 'principal', summary: '', personality: '', background: '', appearance: '', speech: { style: '', examples: [] }, sourceId: 'clara', name: 'Clara', role: 'npc', control: 'agent' })
      session.locations.add({ sourceId: 'bar', name: 'Bar', description: '', features: [] })
    })

    it('is declared, and every value is given where it starts', () => {
      populateVariables(session as never, defs, { characters: [character('clara', { health: 7 })], items: [], locations: [place('bar', { stance: 'tense' })], values: { alarm: true } })
      expect(session.variables.defs().map(def => def.key)).toEqual(['valence', 'arousal', 'dominance', 'health', 'rank', 'stance', 'alarm'])
      expect(session.variables.value('health', 'character', session.characters.getBySourceId('clara')!.id)).toBe(7)
      expect(session.variables.value('stance', 'location', session.locations.getBySourceId('bar')!.id)).toBe('tense')
      expect(session.variables.value('alarm', 'world', 0)).toBe(true)
    })

    it('may redescribe a built-in variable, and still holds the feelings a character starts with', () => {
      populateVariables(session as never, [{ key: 'valence', name: 'Mood', kind: 'number', subject: 'character', bands: [{ upTo: 0, label: 'low' }, { upTo: 1, label: 'high' }] }], { characters: [], items: [], locations: [], values: undefined })
      expect(session.variables.def('valence')).toMatchObject({ name: 'Mood', builtin: true, bands: [{ upTo: 0, label: 'low' }, { upTo: 1, label: 'high' }] })
    })
  })
})

describe('telling what is tracked', () => {
  it('is a line of names and values in words, with the usual value when a temperament differs', () => {
    const store = createSessionStore(':memory:', { id: 's', name: 'S', world: { id: 'w', name: 'W' } })
    const valence = store.variables.def('valence')!
    const health = store.variables.define({ key: 'health', name: 'Health', kind: 'number', subject: 'character', min: 0, max: 10, default: 10, bands: [{ upTo: 3, label: 'hurt' }, { upTo: 10, label: 'well' }] })
    expect(describeShown([{ variable: health, value: 2 }, { variable: valence, value: -0.5, baseline: 0 }, { variable: valence, value: 0.5, baseline: 0.5 }])).toBe('Health: hurt (2); Valence: unhappy (-0.5), usually even (0); Valence: pleased (0.5)')
    expect(describeShown([])).toBe('')
  })
})
