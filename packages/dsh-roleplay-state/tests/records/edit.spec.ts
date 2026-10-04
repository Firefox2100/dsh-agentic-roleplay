import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { InvalidEditError, applyRecordsEdit, characterKey, parseRecordsEdit, readRecords, recordsEditSchema, type RecordsEdit, type SessionStore } from '../../src/index.ts'
import { memoryStore, newCharacter } from '../helpers.ts'

let store: SessionStore
beforeEach(() => {
  store = memoryStore()
  for (const [sourceId, name] of [['alice', 'Alice'], ['bob', 'Bob']] as const) {
    const { id } = store.characters.add(newCharacter({ sourceId, name, aliases: [] }))
    store.characterStates.create(id, { publicState: `${name} waits`, innerState: '', activity: 'idle' })
  }
})
afterEach(() => { store.close() })

const edit = (overrides: Partial<RecordsEdit> = {}): RecordsEdit => ({ turn: 1, ...overrides })
const problemsOf = (change: RecordsEdit): string[] => {
  try { store.edit(change) } catch (error) { if (error instanceof InvalidEditError) return [...error.problems]; throw error }
  return []
}
const idOf = (key: string) => store.characters.getBySourceId(key)!.id

describe('applying an edit', () => {
  it('writes state, events with who took them in, beliefs and threads together', () => {
    const result = store.edit(edit({
      states: [{ character: 'alice', publicState: ' Standing at the bar. ', activity: 'pouring', emotion: { valence: 0.2, arousal: 0.1, dominance: 0 } }],
      events: [{ turn: 1, round: 1, text: ' Bob took the key. ', importance: 4, tags: ['Key', ' key ', 'desk'], involves: ['bob'], perceivedBy: [{ character: 'alice', mode: 'witnessed' }, { character: 'bob', mode: 'witnessed', content: 'I took the key.', accuracy: 'partial' }] }],
      beliefs: [{ character: 'alice', kind: 'relationship', text: 'Bob is a thief.', about: ['bob'], importance: 3 }],
      threadsOpened: ['Where did the key go?'],
    }))
    expect(result).toMatchObject({ eventIds: [1], beliefIds: [1], writes: 4 })
    expect(store.characterStates.get(idOf('alice'))).toMatchObject({ publicState: 'Standing at the bar.', activity: 'pouring', innerState: '' })
    expect(store.characterStates.get(idOf('alice'))?.emotion?.baseline).toEqual({ valence: 0.2, arousal: 0.1, dominance: 0 })
    expect(store.events.get(1)).toMatchObject({ text: 'Bob took the key.', tags: ['key', 'desk'], involves: [idOf('bob')] })
    const perceptions = store.events.perceptionsOf(1)
    expect(perceptions.map(entry => [entry.characterId, entry.content, entry.accuracy])).toEqual([[idOf('alice'), 'Bob took the key.', 'accurate'], [idOf('bob'), 'I took the key.', 'partial']])
    expect(perceptions[0]?.gist).toBe('Bob took the key.')
    expect(store.memories.list(idOf('alice'))[0]).toMatchObject({ turn: 1, about: [idOf('bob')] })
    expect(store.threads.list('open')[0]).toMatchObject({ text: 'Where did the key go?', openedTurn: 1 })
  })

  it('keeps the temperament when only the current emotion changes', () => {
    store.edit(edit({ states: [{ character: 'bob', emotion: { valence: 0.5, arousal: 0, dominance: 0 } }] }))
    store.edit(edit({ states: [{ character: 'bob', emotion: { valence: -0.5, arousal: 0.3, dominance: 0.1 } }] }))
    expect(store.characterStates.get(idOf('bob'))?.emotion).toEqual({ baseline: { valence: 0.5, arousal: 0, dominance: 0 }, immediate: { valence: -0.5, arousal: 0.3, dominance: 0.1 } })
  })

  it('corrects and removes what was recorded', () => {
    store.edit(edit({ events: [{ turn: 1, round: 1, text: 'one', importance: 2, perceivedBy: [{ character: 'alice', mode: 'heard' }] }, { turn: 1, round: 1, text: 'two', importance: 2 }], beliefs: [{ character: 'bob', kind: 'belief', text: 'x', importance: 2 }], threadsOpened: ['t'] }))
    store.edit(edit({
      eventEdits: [{ id: 1, text: 'one, corrected', importance: 5, involves: ['alice'], perceivedBy: [{ character: 'bob', mode: 'told' }] }],
      eventRetractions: [2], beliefEdits: [{ id: 1, text: 'y', about: ['alice'] }], threadsResolved: [1],
    }))
    expect(store.events.list().map(event => [event.id, event.text, event.importance])).toEqual([[1, 'one, corrected', 5]])
    expect(store.events.perceptionsOf(1).map(entry => [entry.characterId, entry.mode])).toEqual([[idOf('bob'), 'told']])
    expect(store.memories.get(1)).toMatchObject({ text: 'y', about: [idOf('alice')] })
    expect(store.threads.get(1)?.status).toBe('resolved')
    store.edit(edit({ beliefRetractions: [1] }))
    expect(store.memories.get(1)).toBeUndefined()
  })

  it('names every problem and writes nothing when there is one', () => {
    const before = store.records()
    expect(problemsOf(edit({
      turn: 0,
      states: [{ character: 'carol', activity: 'x' }, { character: 'alice' }, { character: 'bob', emotion: { valence: 2, arousal: 0, dominance: 0 } }],
      events: [{ turn: 1, round: 1, text: ' ', importance: 9, involves: ['dan'], perceivedBy: [{ character: 'alice', mode: 'witnessed' }, { character: 'alice', mode: 'heard' }, { character: 'bob', mode: 'dreamt' as never }] }],
      eventEdits: [{ id: 99 }], eventRetractions: [98], beliefs: [{ character: 'alice', kind: 'rumour' as never, text: '', importance: 0 }], beliefEdits: [{ id: 97 }], beliefRetractions: [96], threadsResolved: [95], threadsOpened: [' '],
    }))).toEqual([
      'turn must be a whole number from 1',
      'states[0]: there is no character "carol" (the characters are: alice, bob)',
      'states[1]: nothing to change',
      'states[2]: each emotion axis must be a number from -1 to 1',
      'events[0]: say what happened',
      'events[0]: importance must be a whole number from 1 to 5',
      'events[0].involves: there is no character "dan" (the characters are: alice, bob)',
      'events[0].perceived_by[1]: alice is listed twice',
      'events[0].perceived_by[2]: unknown mode "dreamt"',
      'event_edits[0]: there is no event 99',
      'event_retractions: there is no event 98',
      'beliefs[0]: unknown kind "rumour"',
      'beliefs[0]: say what the character believes or knows',
      'beliefs[0]: importance must be a whole number from 1 to 5',
      'belief_edits[0]: there is no belief 97',
      'belief_retractions: there is no belief 96',
      'threads_opened[0]: say what is unsettled',
      'threads_resolved: there is no thread 95',
    ])
    expect(store.records()).toEqual(before)
  })

  it('is undone as a whole when it fails half way', () => {
    store.edit(edit({ events: [{ turn: 1, round: 1, text: 'one', importance: 2 }] }))
    store.events.add = () => { throw new Error('disk full') }
    expect(() => store.edit(edit({ states: [{ character: 'alice', activity: 'changed' }], events: [{ turn: 1, round: 1, text: 'two', importance: 2 }] }))).toThrow('disk full')
    expect(store.characterStates.get(idOf('alice'))?.activity).toBe('idle')
  })
})

describe('the wire format', () => {
  it('reads what models write, in snake_case', () => {
    const parsed = parseRecordsEdit({
      turn: 2,
      states: [{ character: 'alice', public_state: 'p', inner_state: 'i', activity: 'a', emotion: { valence: 0, arousal: 0, dominance: 0 } }],
      events: [{ turn: 2, round: 1, text: 't', importance: 3, tags: ['k'], involves: ['bob'], perceived_by: [{ character: 'alice', mode: 'heard', content: 'c', gist: 'g', accuracy: 'partial' }] }],
      event_edits: [{ id: 1, text: 'x' }], event_retractions: [2], beliefs: [{ character: 'bob', kind: 'belief', text: 'b', about: ['alice'], importance: 2 }],
      belief_edits: [{ id: 1, importance: 4 }], belief_retractions: [3], threads_opened: ['o'], threads_resolved: [4],
    })
    expect(parsed).toEqual({
      turn: 2,
      perceptionEdits: [],
      perceptionsAdded: [],
      characters: [],
      places: [],
      exits: [],
      relationships: [],
      relationshipRetractions: [],
      placeEdits: [],
      exitChanges: [],
      moves: [],
      states: [{ character: 'alice', publicState: 'p', innerState: 'i', activity: 'a', emotion: { valence: 0, arousal: 0, dominance: 0 } }],
      events: [{ turn: 2, round: 1, text: 't', importance: 3, tags: ['k'], involves: ['bob'], perceivedBy: [{ character: 'alice', mode: 'heard', content: 'c', gist: 'g', accuracy: 'partial' }] }],
      eventEdits: [{ id: 1, text: 'x' }], eventRetractions: [2], beliefs: [{ character: 'bob', kind: 'belief', text: 'b', about: ['alice'], importance: 2 }],
      beliefEdits: [{ id: 1, importance: 4 }], beliefRetractions: [3], threadsOpened: ['o'], threadsResolved: [4],
    })
  })

  it('refuses what is not shaped as an edit, and leaves the rest to the checks of applying it', () => {
    expect(() => parseRecordsEdit('x')).toThrow(InvalidEditError)
    expect(() => parseRecordsEdit({ turn: 1, events: 'x', states: [1], event_retractions: ['a'] })).toThrow(/states\[0\] must be an object.*events must be a list.*event_retractions must be a list of numbers/)
    expect(parseRecordsEdit({}).turn).toBe(0)
    expect(problemsOf(parseRecordsEdit({}))).toEqual(['turn must be a whole number from 1'])
  })

  it('has a schema that names the characters a model may use, and adds the corrections when asked', () => {
    const plain = recordsEditSchema({ characters: ['alice', 'bob'] })
    expect(JSON.stringify(plain)).toContain('"enum":["alice","bob"]')
    expect(plain.properties).not.toHaveProperty('event_edits')
    expect(plain.required).toEqual(['turn'])
    expect(recordsEditSchema({ changes: true }).properties).toHaveProperty('event_edits')
    expect(recordsEditSchema().additionalProperties).toBe(false)
  })
})

describe('reading the records back', () => {
  it('shows states, the events of the rounds asked for with who took them in, beliefs of their turns and open threads', () => {
    store.edit(edit({
      events: [{ turn: 1, round: 1, text: 'a', importance: 2, involves: ['alice'], perceivedBy: [{ character: 'alice', mode: 'witnessed' }] }, { turn: 1, round: 2, text: 'b', importance: 2 }],
      beliefs: [{ character: 'alice', kind: 'belief', text: 'x', importance: 2 }], threadsOpened: ['open one'],
    }))
    store.edit({ turn: 2, beliefs: [{ character: 'bob', kind: 'belief', text: 'later', importance: 2 }] })
    const all = readRecords(store)
    expect(all.events).toHaveLength(2)
    expect(all.characters.map(entry => [entry.character, entry.controlled_by, entry.public_state])).toEqual([['alice', 'an agent', 'Alice waits'], ['bob', 'an agent', 'Bob waits']])
    const round = readRecords(store, { rounds: [{ turn: 1, round: 1 }] })
    expect(round.events.map(event => event.text)).toEqual(['a'])
    expect(round.events[0]).toMatchObject({ involves: ['alice'], perceived_by: [{ character: 'alice', mode: 'witnessed', accuracy: 'accurate' }] })
    expect(round.beliefs.map(belief => belief.text)).toEqual(['x'])
    expect(round.open_threads).toEqual([{ id: 1, text: 'open one', opened_turn: 1 }])
  })

  it('names a character by its key: its id in the world, or its number when it has none', () => {
    const made = store.characters.add(newCharacter({ sourceId: undefined, name: 'Walk-on', aliases: [] }))
    expect(characterKey(made)).toBe(String(made.id))
    expect(applyRecordsEdit(store, { turn: 1, states: [{ character: String(made.id), activity: 'x' }] }).writes).toBe(1)
    expect(store.characterStates.get(made.id)?.activity).toBe('x')
  })
})
