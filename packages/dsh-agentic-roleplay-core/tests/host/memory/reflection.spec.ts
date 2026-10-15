import { createSessionStore, type SessionStore } from '@dsh-agentic-roleplay/state'
import { DEFAULT_SETTINGS, type ChatSettings } from '../../../src/shared/settings.ts'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { TurnStore } from '../../../src/host/orchestration/boundaries.ts'
import { dueReflection, editOf, materialOf, proposalProblems, reflectionStatus, type Proposal, type Shown } from '../../../src/host/memory/reflection.ts'

const DAY = 24 * 60 * 60 * 1000
let session: SessionStore
const id = (key: string): number => session.characters.getBySourceId(key)!.id

beforeEach(() => {
  session = createSessionStore(':memory:', { id: 's', name: 'S', world: { id: 'w', name: 'W' } })
  const base = { aliases: [], kind: 'person' as const, summary: '', personality: '', background: '', appearance: '', speech: { style: '', examples: [] } }
  for (const [sourceId, name, control, tier] of [['arthur', 'Arthur', 'player', 'principal'], ['clara', 'Clara', 'agent', 'principal'], ['eleanor', 'Eleanor', 'agent', 'supporting'], ['extra', 'The Extra', 'agent', 'background']] as const) {
    const { id: characterId } = session.characters.add({ ...base, tier, sourceId, name, role: control === 'player' ? 'playable' : 'npc', control })
    session.characterStates.create(characterId, { publicState: '', innerState: '', activity: 'idle' })
  }
})
afterEach(() => { session.close() })

/** An event in a turn that the given characters took in; sealed unless `draft`. */
function happen(turn: number, text: string, by: string[], options: { importance?: number; draft?: boolean } = {}): void {
  session.edit({ turn, events: [{ turn, round: 1, text, importance: options.importance ?? 2, tags: [], involves: [], perceivedBy: by.map(character => ({ character, mode: 'witnessed' as const, content: `${character} saw: ${text}`, gist: text })) }] }, options.draft === true ? {} : { seal: true })
}

describe('what a pass has to sort', () => {
  it('takes the characters with enough new, the most first, and leaves the player, groups and the background alone', () => {
    for (let turn = 1; turn <= 5; turn += 1) happen(turn, `thing ${turn}`, turn <= 2 ? ['clara', 'arthur', 'extra'] : ['clara', 'eleanor', 'arthur', 'extra'])
    expect(materialOf(session, 3).map(entry => entry.character.name)).toEqual(['Clara', 'Eleanor'])
    expect(materialOf(session, 5).map(entry => entry.character.name)).toEqual(['Clara'])
    expect(materialOf(session, 1).map(entry => entry.fresh.length)).toEqual([5, 3])
  })

  it('counts only what is sealed, and only up to the first draft, so that nothing is passed over that is sealed later', () => {
    happen(1, 'one', ['clara'])
    happen(2, 'two', ['clara'], { draft: true })
    happen(3, 'three', ['clara'])
    expect(materialOf(session, 1)[0]!.fresh.map(entry => entry.event.text)).toEqual(['one'])
    session.events.seal()
    expect(materialOf(session, 1)[0]!.fresh.map(entry => entry.event.text)).toEqual(['one', 'two', 'three'])
  })

  it('starts after what an earlier pass reached, and takes at most 40 at a time', () => {
    for (let turn = 1; turn <= 45; turn += 1) happen(turn, `thing ${turn}`, ['clara'])
    const first = materialOf(session, 1)[0]!
    expect(first.fresh).toHaveLength(40)
    session.metadata.setValue('reflection.cursor', { clara: first.fresh.at(-1)!.perception.id })
    expect(materialOf(session, 1)[0]!.fresh.map(entry => entry.event.text)).toEqual(['thing 41', 'thing 42', 'thing 43', 'thing 44', 'thing 45'])
  })
})

describe('what a proposal may rest on', () => {
  let shown: Shown
  const named = (name: string): string | undefined => session.characters.findByName(name).length === 1 ? session.characters.findByName(name)[0]!.sourceId : undefined

  beforeEach(() => {
    happen(1, 'Clara is short with the mayor', ['clara'])
    happen(1, 'Clara hears the mayor was seen at night', ['clara'])
    happen(4, 'The mayor lies to Clara about the ledger', ['clara'], { importance: 4 })
    happen(6, 'The mayor avoids Clara', ['clara'])
    session.edit({ turn: 2, beliefs: [{ character: 'clara', kind: 'belief', text: 'The mayor is honest.', importance: 3 }, { character: 'clara', kind: 'belief', text: 'The mayor is straight.', importance: 2 }] })
    const material = materialOf(session, 1)[0]!
    shown = { perceptions: new Map(material.fresh.map(entry => [entry.perception.id, entry])), beliefs: new Map(material.beliefs.map(belief => [belief.id, belief])) }
  })

  const at = (turn: number): number => [...shown.perceptions.values()].find(entry => entry.event.turn === turn)!.perception.id
  const belief = (text: string): number => [...shown.beliefs.values()].find(entry => entry.text === text)!.id
  const none = { add: [], revise: [], drop: [] }
  const problems = (proposal: Partial<Proposal>): string[] => proposalProblems({ ...none, ...proposal }, shown, named)

  it('accepts nothing at all, and a belief resting on things from two different turns', () => {
    expect(problems({})).toEqual([])
    expect(problems({ add: [{ kind: 'belief', text: 'The mayor hides something.', importance: 3, about: ['Arthur'], perceptions: [at(1), at(6)] }] })).toEqual([])
  })

  it('refuses a belief from one passing moment, but accepts one from a single event that turned the story', () => {
    expect(problems({ add: [{ kind: 'belief', text: 'The mayor hides something.', importance: 3, perceptions: [at(1)] }] })).toEqual([expect.stringContaining('one passing moment')])
    expect(problems({ add: [{ kind: 'belief', text: 'The mayor lied.', importance: 4, perceptions: [at(4)] }] })).toEqual([])
  })

  it('counts a belief it builds on as evidence from its own turn', () => {
    expect(problems({ add: [{ kind: 'belief', text: 'The mayor is not what he seems.', importance: 3, perceptions: [at(6)], beliefs: [belief('The mayor is honest.')] }] })).toEqual([])
  })

  it('refuses numbers it was not shown, names that are no character, and text that is empty or too long', () => {
    expect(problems({ add: [{ kind: 'belief', text: ' ', importance: 9, about: ['Nobody'], perceptions: [9999] }] })).toEqual(expect.arrayContaining([expect.stringContaining('9999'), expect.stringContaining('say what it believes'), expect.stringContaining('importance runs from'), expect.stringContaining('"Nobody" is not a character')]))
    expect(problems({ add: [{ kind: 'belief', text: 'x'.repeat(301), importance: 3, perceptions: [at(1), at(6)] }] })).toEqual([expect.stringContaining('at most 300')])
  })

  it('lets a belief be revised or dropped only for what came after it', () => {
    const honest = belief('The mayor is honest.')
    expect(problems({ revise: [{ id: honest, text: 'The mayor may be honest, but lied once.', perceptions: [at(4)] }] })).toEqual([])
    expect(problems({ revise: [{ id: honest, text: 'Changed.', perceptions: [at(1)] }] })).toEqual([expect.stringContaining('came before the belief was formed')])
    expect(problems({ revise: [{ id: honest, perceptions: [at(4)] }] })).toEqual([expect.stringContaining('say what changes')])
    expect(problems({ drop: [{ id: honest, perceptions: [] }] })).toEqual([expect.stringContaining('bears on it')])
    expect(problems({ drop: [{ id: honest, perceptions: [at(4)] }] })).toEqual([])
  })

  it('lets a duplicate be dropped into a belief that stays, and not into itself or into one that goes too', () => {
    const honest = belief('The mayor is honest.')
    const straight = belief('The mayor is straight.')
    expect(problems({ drop: [{ id: straight, merged_into: honest }] })).toEqual([])
    expect(problems({ drop: [{ id: straight, merged_into: straight }] })).toEqual([expect.stringContaining('merge into a belief that stays')])
    expect(problems({ drop: [{ id: straight, merged_into: honest }, { id: honest, merged_into: straight }] })).toHaveLength(2)
  })

  it('refuses to change the same belief twice, and too many changes in one pass', () => {
    const honest = belief('The mayor is honest.')
    expect(problems({ revise: [{ id: honest, text: 'A.', perceptions: [at(4)] }], drop: [{ id: honest, perceptions: [at(4)] }] })).toEqual([expect.stringContaining('already changed')])
    const many = Array.from({ length: 5 }, () => ({ kind: 'belief', text: 'x', importance: 2, perceptions: [at(1), at(6)] }))
    expect(problems({ add: many })).toEqual(expect.arrayContaining([expect.stringContaining('at most 4 new beliefs')]))
  })

  it('writes what passed as beliefs of that character only, found by the names it gave', () => {
    const honest = belief('The mayor is honest.')
    const straight = belief('The mayor is straight.')
    const proposal: Proposal = { add: [{ kind: 'belief', text: 'Arthur is hiding why he came.', importance: 3, about: ['Arthur'], perceptions: [at(1), at(6)] }], revise: [{ id: honest, text: 'The mayor lied once.', importance: 4, perceptions: [at(4)] }], drop: [{ id: straight, merged_into: honest }] }
    expect(problems(proposal)).toEqual([])
    session.edit(editOf(7, session.characters.getBySourceId('clara')!, proposal, named))
    const beliefs = session.memories.list(id('clara'))
    expect(beliefs.map(entry => [entry.text, entry.importance, entry.turn])).toEqual(expect.arrayContaining([['The mayor lied once.', 4, 2], ['Arthur is hiding why he came.', 3, 7]]))
    expect(beliefs).toHaveLength(2)
    expect(beliefs.find(entry => entry.text.startsWith('Arthur'))!.about).toEqual([id('arthur')])
    expect(session.memories.list(id('eleanor'))).toEqual([])
  })
})

describe('when the story reflects by itself', () => {
  let settings: ChatSettings
  let turnNow: number
  let player: number

  const store = (): TurnStore => ({
    story: session,
    settings: () => settings,
    time: () => ({ now: turnNow, zone: 'UTC' }),
    cast: () => [{ key: 'arthur', character: session.characters.getBySourceId('arthur')!, place: { location: session.locations.get(player)!, position: '' } }],
  }) as unknown as TurnStore

  beforeEach(() => {
    settings = structuredClone(DEFAULT_SETTINGS)
    settings.reflection = { auto: true, everyTurns: 20, onSceneChange: true, sceneDays: 1, minTurns: 5, perRun: 3, minNew: 4 }
    session.edit({ turn: 1, places: [{ key: 'inn', name: 'Inn' }, { key: 'room', name: 'Room', parent: 'inn' }, { key: 'square', name: 'Square' }] })
    player = session.locations.getBySourceId('inn')!.id
    turnNow = 10 * DAY
  })

  it('only looks at first, and then waits for the turns that were asked for', () => {
    expect(dueReflection(store(), 1)).toBeUndefined()
    expect(dueReflection(store(), 19)).toBeUndefined()
    expect(dueReflection(store(), 20)).toBe('turns')
  })

  it('does nothing when it is off, and does not count turns when that trigger is off', () => {
    settings.reflection.auto = false
    expect(dueReflection(store(), 50)).toBeUndefined()
    settings.reflection.auto = true
    settings.reflection.everyTurns = 0
    dueReflection(store(), 1)
    expect(dueReflection(store(), 500)).toBeUndefined()
  })

  it('takes the player leaving for another place as a change of scene, but not going into a room of the same building', () => {
    dueReflection(store(), 1)
    player = session.locations.getBySourceId('room')!.id
    expect(dueReflection(store(), 8)).toBeUndefined()
    player = session.locations.getBySourceId('square')!.id
    expect(dueReflection(store(), 8)).toBe('scene')
    settings.reflection.onSceneChange = false
    expect(dueReflection(store(), 8)).toBeUndefined()
  })

  it('takes a day of story time as a change of scene, and waits out the fewest turns between two passes', () => {
    dueReflection(store(), 1)
    turnNow += DAY
    expect(dueReflection(store(), 3)).toBeUndefined()
    expect(dueReflection(store(), 6)).toBe('scene')
    settings.reflection.sceneDays = 0
    expect(dueReflection(store(), 6)).toBeUndefined()
  })

  it('measures from the last pass', () => {
    dueReflection(store(), 1)
    session.metadata.setValue('reflection.last', { turn: 18, at: 'x', reason: 'manual', characters: [] })
    expect(dueReflection(store(), 20)).toBeUndefined()
    expect(dueReflection(store(), 38)).toBe('turns')
  })
})

describe('what the settings tab is told', () => {
  it('is nothing before a pass, then the pass, then why one failed', () => {
    expect(reflectionStatus(session, false)).toEqual({ running: false })
    session.metadata.setValue('reflection.last', { turn: 20, at: '2026-10-15T10:00:00.000Z', reason: 'turns', characters: [{ name: 'Clara', added: 1, revised: 0, dropped: 2 }] })
    session.metadata.setValue('reflection.error', { at: '2026-10-15T11:00:00.000Z', message: 'the model did not answer' })
    expect(reflectionStatus(session, true)).toEqual({ running: true, last: { turn: 20, at: '2026-10-15T10:00:00.000Z', reason: 'turns', characters: [{ name: 'Clara', added: 1, revised: 0, dropped: 2 }] }, error: { at: '2026-10-15T11:00:00.000Z', message: 'the model did not answer' } })
  })
})
