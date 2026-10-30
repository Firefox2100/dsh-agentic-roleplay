import { beforeEach, describe, expect, it } from 'vitest'
import { ConflictError, EMOTION_VARIABLES, InvalidEditError, InvalidValueError, NotFoundError, changeVariable, describeValue, planVariableChange, shownVariables, valueIssue, type SessionStore } from '../src/index.ts'
import { memoryStore, newCharacter } from './helpers.ts'

let store: SessionStore
const alice = () => store.characters.getBySourceId('alice')!.id
const bob = () => store.characters.getBySourceId('bob')!.id

beforeEach(() => {
  store = memoryStore()
  for (const [sourceId, name] of [['alice', 'Alice'], ['bob', 'Bob']] as const) store.characters.add(newCharacter({ sourceId, name, aliases: [] }))
  store.edit({ turn: 1, places: [{ key: 'bar', name: 'The Bar' }], items: [{ key: 'lamp', name: 'Lamp', at: { location: 'bar' } }] })
})

describe('what every story tracks', () => {
  it('is the feelings of characters: numbers from -1 to 1 with a temperament, private', () => {
    expect(store.variables.defs().map(def => def.key)).toEqual(['valence', 'arousal', 'dominance'])
    expect(store.variables.def('valence')).toMatchObject({ kind: 'number', subject: 'character', min: -1, max: 1, baseline: true, visibility: 'private', builtin: true, default: 0 })
    expect(EMOTION_VARIABLES).toHaveLength(3)
    store.variables.ensureDefaults()
    expect(store.variables.defs()).toHaveLength(3)
  })

  it('cannot be removed, nor made into something else, but can be described and worded differently', () => {
    expect(() => store.variables.remove('valence')).toThrow(ConflictError)
    const changed = store.variables.define({ key: 'valence', name: 'Mood', kind: 'flag', subject: 'item', description: 'How it feels.', bands: [{ upTo: 0, label: 'low' }, { upTo: 1, label: 'high' }] })
    expect(changed).toMatchObject({ name: 'Mood', kind: 'number', subject: 'character', description: 'How it feels.', min: -1, builtin: true, bands: [{ upTo: 0, label: 'low' }, { upTo: 1, label: 'high' }] })
  })
})

describe('declaring a variable', () => {
  it('takes a kind, what it is about, bounds or words, a default, who can tell and what to call ranges', () => {
    const health = store.variables.define({ key: 'health', name: 'Health', kind: 'number', subject: 'character', min: 0, max: 10, integer: true, default: 10, visibility: 'public', bands: [{ upTo: 3, label: 'hurt' }, { upTo: 10, label: 'well' }], always: true })
    expect(health).toMatchObject({ key: 'health', min: 0, max: 10, integer: true, default: 10, visibility: 'public', always: true, builtin: false, only: [], baseline: false })
    const mood = store.variables.define({ key: 'door', name: 'Door', kind: 'choice', subject: 'item', options: ['shut', 'ajar', 'open'], only: ['lamp'], visibility: 'hidden' })
    expect(mood).toMatchObject({ options: ['shut', 'ajar', 'open'], default: 'shut', only: ['lamp'] })
    expect(store.variables.define({ key: 'alarm', name: 'Alarm raised', kind: 'flag', subject: 'world' })).toMatchObject({ default: false, subject: 'world' })
    expect(store.variables.defs().map(def => def.key)).toEqual(['valence', 'arousal', 'dominance', 'health', 'door', 'alarm'])
  })

  it('is redeclared in place, keeping its place in the order and its values', () => {
    store.variables.define({ key: 'health', name: 'Health', kind: 'number', subject: 'character', min: 0, max: 10, default: 10 })
    store.variables.set('health', 'character', alice(), { value: 4 }, 2)
    store.variables.define({ key: 'health', name: 'Vitality', kind: 'number', subject: 'character', min: 0, max: 20, default: 10 })
    expect(store.variables.defs().map(def => def.key)).toEqual(['valence', 'arousal', 'dominance', 'health'])
    expect(store.variables.def('health')?.name).toBe('Vitality')
    expect(store.variables.value('health', 'character', alice())).toBe(4)
  })

  it('is refused when it is not one: the key, kind, bounds, default, options, bands, privacy', () => {
    const bad = (extra: Record<string, unknown>): string => {
      try { store.variables.define({ key: 'x', name: 'X', kind: 'number', subject: 'character', ...extra } as never); return 'allowed' } catch (error) { expect(error).toBeInstanceOf(InvalidValueError); return (error as Error).message }
    }
    expect(bad({ key: 'Bad Key' })).toMatch(/lowercase letters/)
    expect(bad({ name: ' ' })).toMatch(/give it a name/)
    expect(bad({ kind: 'text' })).toMatch(/unknown kind/)
    expect(bad({ subject: 'room' })).toMatch(/unknown subject/)
    expect(bad({ min: 5, max: 1 })).toMatch(/bounds/)
    expect(bad({ min: 0, max: 1, default: 2 })).toMatch(/default is not acceptable: x is a number from 0 up to 1/)
    expect(bad({ kind: 'choice', options: ['one'] })).toMatch(/from 2 to 12/)
    expect(bad({ kind: 'choice', options: ['a', 'a'] })).toMatch(/from 2 to 12/)
    expect(bad({ kind: 'flag', min: 0 })).toMatch(/only a number/)
    expect(bad({ kind: 'flag', baseline: true })).toMatch(/no baseline/)
    expect(bad({ options: ['a', 'b'] })).toMatch(/a number has no options/)
    expect(bad({ bands: [{ upTo: 2, label: 'a' }, { upTo: 1, label: 'b' }] })).toMatch(/bands are from 1 to 8/)
    expect(bad({ visibility: 'private', subject: 'item' })).toMatch(/only what belongs to a character can be private/)
    expect(bad({ subject: 'world', only: ['a'] })).toMatch(/only one world/)
    expect(bad({ visibility: 'secret' })).toMatch(/unknown visibility/)
  })

  it('goes with its values when removed', () => {
    store.variables.define({ key: 'alarm', name: 'Alarm', kind: 'flag', subject: 'world' })
    store.variables.set('alarm', 'world', 0, { value: true }, 2)
    expect(store.variables.remove('alarm')).toBe(true)
    expect(store.variables.remove('alarm')).toBe(false)
    expect(store.variables.all()).toEqual([])
  })
})

describe('values', () => {
  beforeEach(() => {
    store.variables.define({ key: 'health', name: 'Health', kind: 'number', subject: 'character', min: 0, max: 10, integer: true, default: 10 })
    store.variables.define({ key: 'lit', name: 'Lit', kind: 'flag', subject: 'item', only: ['lamp'] })
  })

  it('are the default until set, then the value with the turn it changed in', () => {
    expect(store.variables.value('health', 'character', alice())).toBe(10)
    expect(store.variables.get('health', 'character', alice())).toBeUndefined()
    expect(store.variables.set('health', 'character', alice(), { value: 6 }, 3)).toEqual({ variable: 'health', subject: 'character', subjectId: alice(), value: 6, updatedTurn: 3 })
    expect(store.variables.value('health', 'character', alice())).toBe(6)
    expect(store.variables.value('health', 'character', bob())).toBe(10)
    expect(store.variables.list('character', alice()).map(entry => entry.variable)).toEqual(['health'])
  })

  it('have a baseline when the variable does: the first value sets it, a later one leaves it, and it can be set apart', () => {
    store.variables.set('valence', 'character', alice(), { value: 0.4 }, 1)
    store.variables.set('valence', 'character', alice(), { value: -0.2 }, 2)
    expect(store.variables.get('valence', 'character', alice())).toMatchObject({ value: -0.2, baseline: 0.4 })
    store.variables.set('valence', 'character', alice(), { baseline: 0.1 }, 3)
    expect(store.variables.get('valence', 'character', alice())).toMatchObject({ value: -0.2, baseline: 0.1 })
    store.variables.set('arousal', 'character', bob(), { baseline: 0.5 }, 1)
    expect(store.variables.get('arousal', 'character', bob())).toMatchObject({ value: 0.5, baseline: 0.5 })
    expect(() => store.variables.set('health', 'character', bob(), { baseline: 5 }, 1)).toThrow(/has no baseline/)
  })

  it('are refused when they are not possible for the variable, or the subject is not one it applies to', () => {
    expect(() => store.variables.set('health', 'character', alice(), { value: 11 }, 1)).toThrow(/from 0 up to 10/)
    expect(() => store.variables.set('health', 'character', alice(), { value: 2.5 }, 1)).toThrow(/whole number/)
    expect(() => store.variables.set('health', 'character', alice(), { value: 'ill' as never }, 1)).toThrow(/is a number/)
    expect(() => store.variables.set('lit', 'item', 1, { value: 1 as never }, 1)).toThrow(/yes or no/)
    expect(() => store.variables.set('health', 'item', 1, { value: 1 }, 1)).toThrow(/does not apply/)
    const other = store.items.add({ sourceId: 'candle', name: 'Candle', description: '', quantity: 1, unique: false, quality: '', notable: false, hidden: false }, { kind: 'location', locationId: store.locations.getBySourceId('bar')!.id })
    expect(() => store.variables.set('lit', 'item', other.id, { value: true }, 1)).toThrow(/does not apply/)
    expect(() => store.variables.set('nothing', 'world', 0, { value: 1 }, 1)).toThrow(NotFoundError)
    expect(store.variables.get('health', 'character', alice())).toBeUndefined()
  })

  it('say whether they are acceptable', () => {
    const def = { key: 'k', kind: 'choice' as const, options: ['a', 'b'], integer: false }
    expect([valueIssue(def, 'a'), valueIssue(def, 'c'), valueIssue({ ...def, kind: 'flag' }, true), valueIssue({ ...def, kind: 'number' }, Number.NaN)]).toEqual([undefined, 'k is one of: a, b', undefined, 'k is a number'])
  })
})

describe('changing what is tracked', () => {
  beforeEach(() => {
    store.variables.define({ key: 'health', name: 'Health', kind: 'number', subject: 'character', min: 0, max: 10, integer: true, default: 10, visibility: 'public', bands: [{ upTo: 3, label: 'hurt' }, { upTo: 10, label: 'well' }] })
    store.variables.define({ key: 'lit', name: 'Lit', kind: 'flag', subject: 'item', visibility: 'public' })
    store.variables.define({ key: 'alarm', name: 'Alarm', kind: 'flag', subject: 'world', visibility: 'hidden' })
    store.variables.define({ key: 'stance', name: 'Stance', kind: 'choice', subject: 'location', options: ['calm', 'tense'], visibility: 'public' })
  })

  it('sets a value or moves a number by an amount that stops at its bounds, and says what it came to', () => {
    expect(changeVariable(store, { variable: 'health', subject: 'alice', to: 7 }, 2)).toMatchObject({ subjectName: 'Alice', from: 10, to: 7 })
    expect(changeVariable(store, { variable: 'health', subject: 'alice', by: -20 }, 3)).toMatchObject({ from: 7, to: 0 })
    expect(changeVariable(store, { variable: 'health', subject: 'alice', by: 99 }, 4)).toMatchObject({ from: 0, to: 10 })
    expect(changeVariable(store, { variable: 'health', subject: 'bob', by: -2.4 }, 4).to).toBe(8)
    expect(changeVariable(store, { variable: 'lit', subject: 'lamp', to: true }, 2).subjectName).toBe('Lamp')
    expect(changeVariable(store, { variable: 'stance', subject: 'bar', to: 'tense' }, 2).subjectName).toBe('The Bar')
    expect(changeVariable(store, { variable: 'alarm', subject: 'world', to: true }, 2).subjectName).toBe('the world')
    expect(store.variables.value('alarm', 'world', 0)).toBe(true)
  })

  it('finds a variable written by its name or in other letter case, when only one has it', () => {
    expect(changeVariable(store, { variable: 'Health', subject: 'alice', to: 6 }, 2)).toMatchObject({ variable: { key: 'health' }, to: 6 })
    expect(changeVariable(store, { variable: ' VALENCE ', subject: 'alice', to: 0.2 }, 2).variable.key).toBe('valence')
    store.variables.define({ key: 'wounds', name: 'Health', kind: 'number', subject: 'character' })
    const plan = planVariableChange(store, { variable: 'HEALTH', subject: 'alice', to: 1 })
    expect(plan.ok).toBe(false)
  })

  it('moves a temperament apart from the feeling', () => {
    changeVariable(store, { variable: 'valence', subject: 'alice', to: -0.4 }, 2)
    changeVariable(store, { variable: 'valence', subject: 'alice', baseline: 0.3 }, 2)
    expect(store.variables.get('valence', 'character', alice())).toMatchObject({ value: -0.4, baseline: 0.3 })
  })

  it('says every reason it cannot be done, and changes nothing', () => {
    const problems = (spec: Parameters<typeof planVariableChange>[1]): string[] => { const plan = planVariableChange(store, spec); return plan.ok ? [] : plan.problems }
    expect(problems({ variable: 'mana', subject: 'alice', to: 1 })).toEqual(['there is no variable "mana" (list_variables shows them)'])
    expect(problems({ variable: 'health', subject: 'alice' })).toEqual(['health: give exactly one of to, by and baseline'])
    expect(problems({ variable: 'health', subject: 'alice', to: 1, by: 1 })).toEqual(['health: give exactly one of to, by and baseline'])
    expect(problems({ variable: 'health', subject: 'ghost', to: 1 })).toEqual(['health: there is no character "ghost"'])
    expect(problems({ variable: 'alarm', subject: 'bar', to: true })).toEqual(['alarm: there is no world: use "world"'])
    expect(problems({ variable: 'health', subject: 'alice', to: 11 })).toEqual(['health: health is a number from 0 up to 10'])
    expect(problems({ variable: 'lit', subject: 'lamp', by: 1 })).toEqual(['lit: only a number goes up or down by an amount; use to'])
    expect(problems({ variable: 'health', subject: 'alice', baseline: 5 })).toEqual(['health: health has no baseline'])
    expect(() => changeVariable(store, { variable: 'health', subject: 'alice', to: 99 }, 2)).toThrow(InvalidEditError)
    expect(store.variables.all()).toEqual([])
  })

  it('is described in words: a band and the number, yes or no, the word', () => {
    const health = store.variables.def('health')!
    expect([describeValue(health, 2), describeValue(health, 9.5), describeValue(health, 99)]).toEqual(['hurt (2)', 'well (9.5)', 'well (99)'])
    expect([describeValue(health, true), describeValue(health, 'x'), describeValue({ ...health, bands: [] }, 0.333)]).toEqual(['yes', 'x', '0.33'])
  })

  it('is shown by what a reader may know and what is worth telling: not defaults, unless always; public to anyone, private to its character, hidden to the story', () => {
    store.variables.define({ key: 'rep', name: 'Reputation', kind: 'number', subject: 'character', min: -5, max: 5, default: 0, visibility: 'hidden' })
    store.variables.define({ key: 'name_known', name: 'Name known', kind: 'flag', subject: 'character', always: true, visibility: 'public' })
    changeVariable(store, { variable: 'health', subject: 'alice', to: 2 }, 2)
    changeVariable(store, { variable: 'valence', subject: 'alice', to: -0.5 }, 2)
    changeVariable(store, { variable: 'rep', subject: 'alice', to: 3 }, 2)
    const shown = (audience: 'story' | 'self' | 'others') => shownVariables(store, 'character', alice(), 'alice', audience).map(entry => entry.variable.key)
    expect(shown('story')).toEqual(['valence', 'health', 'rep', 'name_known'])
    expect(shown('self')).toEqual(['valence', 'health', 'name_known'])
    expect(shown('others')).toEqual(['health', 'name_known'])
    expect(shownVariables(store, 'character', bob(), 'bob', 'story').map(entry => entry.variable.key)).toEqual(['name_known'])
  })

  it('is told for at most eight variables of a subject', () => {
    for (let index = 0; index < 12; index += 1) store.variables.define({ key: `p${index}`, name: 'P', kind: 'flag', subject: 'character', always: true, visibility: 'public' })
    expect(shownVariables(store, 'character', alice(), 'alice', 'story')).toHaveLength(8)
  })

  it('applies only to those a variable names', () => {
    store.variables.define({ key: 'rank', name: 'Rank', kind: 'number', subject: 'character', only: ['bob'], default: 1, always: true, visibility: 'public' })
    expect(shownVariables(store, 'character', alice(), 'alice', 'story').map(entry => entry.variable.key)).not.toContain('rank')
    expect(shownVariables(store, 'character', bob(), 'bob', 'story').map(entry => entry.variable.key)).toContain('rank')
    expect(planVariableChange(store, { variable: 'rank', subject: 'alice', to: 2 })).toEqual({ ok: false, problems: ['rank does not apply to Alice (it applies to: bob)'] })
  })
})

describe('through an edit', () => {
  it('declares what the story now tracks and changes it in the same call, or nothing at all', () => {
    const result = store.edit({
      turn: 2,
      variables: [{ key: 'debt', name: 'Debt to the mayor', kind: 'number', subject: 'character', only: ['alice'], min: 0, default: 0, visibility: 'public' }],
      variableChanges: [{ variable: 'debt', subject: 'alice', to: 50 }, { variable: 'valence', subject: 'bob', by: -0.3 }],
    })
    expect(result.writes).toBe(3)
    expect(store.variables.value('debt', 'character', alice())).toBe(50)
    expect(store.variables.value('valence', 'character', bob())).toBe(-0.3)
  })

  it('names what is wrong, and writes nothing', () => {
    const problems = (edit: Parameters<SessionStore['edit']>[0]): string[] => { try { store.edit(edit); return [] } catch (error) { return error instanceof InvalidEditError ? [...error.problems] : (() => { throw error })() } }
    expect(problems({ turn: 2, variableChanges: [{ variable: 'mana', subject: 'alice', to: 1 }, { variable: 'valence', subject: 'alice', to: 5 }] })).toEqual([
      'variable_changes[0]: there is no variable "mana" (list_variables shows them)',
      'variable_changes[1]: valence: valence is a number from -1 up to 1',
    ])
    expect(problems({ turn: 2, variables: [{ key: 'Bad', name: 'X', kind: 'flag', subject: 'world' }], variableChanges: [{ variable: 'valence', subject: 'alice', to: 0.5 }] })).toEqual(['variables[0]: Bad: the key is lowercase letters, digits and underscores, starting with a letter, at most 40 characters'])
    expect(store.variables.all()).toEqual([])
  })

  it('shows what is declared and what is not the default, with the words and who can tell', () => {
    store.edit({ turn: 2, variables: [{ key: 'health', name: 'Health', kind: 'number', subject: 'character', min: 0, max: 10, default: 10, visibility: 'public', bands: [{ upTo: 3, label: 'hurt' }, { upTo: 10, label: 'well' }] }], variableChanges: [{ variable: 'health', subject: 'alice', to: 2 }, { variable: 'valence', subject: 'bob', to: 0 }] })
    const view = store.records()
    expect(view.variable_defs.map(def => def.key)).toEqual(['valence', 'arousal', 'dominance', 'health'])
    expect(view.variables).toEqual([{ variable: 'health', subject: 'alice', about: 'Alice', value: 2, described: 'hurt (2)', baseline: null, visibility: 'public' }])
  })

  it('reads and offers the wire format, snake case, with a value that is a number, a flag or a word', () => {
    const parsed = parseRecordsEditForTest()
    expect(parsed.variableChanges).toEqual([{ variable: 'door', subject: 'lamp', to: 'ajar' }, { variable: 'health', subject: 'alice', by: -2 }, { variable: 'alarm', subject: 'world', to: true }, { variable: 'valence', subject: 'bob', baseline: 0.2 }])
    expect(parsed.variables).toEqual([{ key: 'door', name: 'Door', kind: 'choice', subject: 'item', options: ['shut', 'ajar'], default: 'shut', visibility: 'hidden', bands: [{ upTo: 1, label: 'x' }], always: true }])
  })
})

import { parseRecordsEdit, recordsEditSchema } from '../src/index.ts'
function parseRecordsEditForTest() {
  return parseRecordsEdit({
    turn: 2,
    variable_changes: [{ variable: 'door', subject: 'lamp', to: 'ajar' }, { variable: 'health', subject: 'alice', by: -2 }, { variable: 'alarm', subject: 'world', to: true }, { variable: 'valence', subject: 'bob', baseline: 0.2 }],
    variables: [{ key: 'door', name: 'Door', kind: 'choice', subject: 'item', options: ['shut', 'ajar'], default: 'shut', visibility: 'hidden', bands: [{ up_to: 1, label: 'x' }], always: true }],
  })
}

describe('the schema', () => {
  it('lets everyone change variables, and only the one who declares things declare them', () => {
    expect(Object.keys(recordsEditSchema().properties ?? {})).toContain('variable_changes')
    expect(Object.keys(recordsEditSchema().properties ?? {})).not.toContain('variables')
    expect(Object.keys(recordsEditSchema({ authoring: true }).properties ?? {})).toContain('variables')
  })
})
