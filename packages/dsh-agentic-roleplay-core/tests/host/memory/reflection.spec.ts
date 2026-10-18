import { createSessionStore, type SessionStore } from '@dsh-agentic-roleplay/state'
import { DEFAULT_SETTINGS, type ChatSettings } from '../../../src/shared/settings.ts'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { TurnStore } from '../../../src/host/orchestration/boundaries.ts'
import { bearingOn, checkProblem, dueReflection, editOf, materialOf, proposalProblems, reflectionStatus, withDoubts, settleProposal, type CheckAnswer, type Proposal, type Shown } from '../../../src/host/memory/reflection.ts'

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

  it('refuses a confidence that is not one, and being sure from one turn', () => {
    expect(problems({ add: [{ kind: 'belief', text: 'The mayor lied.', importance: 4, confidence: 'certain' as never, perceptions: [at(4)] }] })).toEqual([expect.stringContaining('confidence is one of doubtful, likely, sure')])
    expect(problems({ add: [{ kind: 'belief', text: 'The mayor lied.', importance: 4, confidence: 'sure', perceptions: [at(4)] }] })).toEqual([expect.stringContaining('at least two different turns')])
    expect(problems({ add: [{ kind: 'belief', text: 'The mayor hides something.', importance: 3, confidence: 'sure', perceptions: [at(4), at(6)] }] })).toEqual([])
    expect(problems({ add: [{ kind: 'belief', text: 'The mayor hides something.', importance: 3, confidence: 'doubtful', perceptions: [at(4)] }] })).toEqual([])
  })

  it('has a belief that something contradicts doubted, and a belief doubted only for what contradicts it', () => {
    const honest = belief('The mayor is honest.')
    expect(problems({ revise: [{ id: honest, contradicted_by: [at(4)], confidence: 'doubtful' }] })).toEqual([])
    expect(problems({ revise: [{ id: honest, contradicted_by: [at(4)] }] })).toEqual([expect.stringContaining('must be doubted: lower its confidence')])
    expect(problems({ revise: [{ id: honest, contradicted_by: [at(4)], confidence: 'likely' }] })).toEqual([expect.stringContaining('must be doubted: lower its confidence')])
    expect(problems({ revise: [{ id: honest, perceptions: [at(4)], confidence: 'doubtful' }] })).toEqual([expect.stringContaining('name what contradicts it in contradicted_by')])
    expect(problems({ revise: [{ id: honest, contradicted_by: [at(1)], confidence: 'doubtful' }] })).toEqual([expect.stringContaining('came before the belief was formed')])
  })

  it('has doubting a belief be one step: the belief and what speaks against it, the confidence lowered for the character', () => {
    const honest = belief('The mayor is honest.')
    expect(problems({ doubt: [{ id: honest, contradicted_by: [at(4)] }] })).toEqual([])
    expect(problems({ doubt: [{ id: honest, contradicted_by: [] }] })).toEqual(expect.arrayContaining([expect.stringContaining('name what speaks against the belief in contradicted_by')]))
    expect(problems({ doubt: [{ id: honest, contradicted_by: [at(1)] }] })).toEqual([expect.stringContaining('came before the belief was formed')])
    expect(problems({ doubt: [{ id: 999, contradicted_by: [at(4)] }] })).toEqual([expect.stringContaining('there is no belief numbered 999')])
    expect(problems({ doubt: [{ id: honest, contradicted_by: [at(4)] }], drop: [{ id: honest, perceptions: [at(4)] }] })).toEqual([expect.stringContaining('already changed')])
    expect(problems({ doubt: [{ id: honest, contradicted_by: [at(4)], text: 'The mayor is honest (doubtful, importance 4, perceptions [3])' }] })).toEqual([expect.stringContaining('fields of their own')])
    expect(problems({ revise: [{ id: honest, text: 'The mayor lied. (sure, importance 4)', perceptions: [at(4)] }] })).toEqual([expect.stringContaining('fields of their own')])
  })

  it('writes a doubt as a lower confidence and a link to what speaks against the belief', () => {
    const honest = belief('The mayor is honest.')
    session.memories.update(honest, { confidence: 'sure' })
    const clara = session.characters.getBySourceId('clara')!
    const proposal: Proposal = { add: [], revise: [], doubt: [{ id: honest, contradicted_by: [at(4)], text: 'The mayor may not be honest after all.' }], drop: [] }
    session.edit(editOf(7, clara, proposal, named, belief => session.memories.get(belief)?.confidence))
    expect(session.memories.get(honest)).toMatchObject({ confidence: 'likely', text: 'The mayor may not be honest after all.' })
    expect(session.memories.evidenceOf(honest)).toEqual([{ memoryId: honest, perceptionId: at(4), relation: 'contradicts', turn: 7 }])
    session.edit(editOf(8, clara, { add: [], revise: [], doubt: [{ id: honest, contradicted_by: [at(6)] }], drop: [] }, named, belief => session.memories.get(belief)?.confidence))
    expect(session.memories.get(honest)?.confidence).toBe('doubtful')
  })

  it('lets a belief be made sure only by things from two turns, counting what it already rests on', () => {
    const honest = belief('The mayor is honest.')
    expect(problems({ revise: [{ id: honest, perceptions: [at(4)], confidence: 'sure' }] })).toEqual([expect.stringContaining('at least two different turns')])
    expect(problems({ revise: [{ id: honest, perceptions: [at(4), at(6)], confidence: 'sure' }] })).toEqual([])
    const resting = { ...shown, supportTurns: new Map([[honest, new Set([2])]]) }
    expect(proposalProblems({ ...none, revise: [{ id: honest, perceptions: [at(4)], confidence: 'sure' }] }, resting, named)).toEqual([])
  })

  it('writes the confidence, what a belief rests on and what speaks against it', () => {
    const honest = belief('The mayor is honest.')
    const proposal: Proposal = { add: [{ kind: 'belief', text: 'Arthur is hiding why he came.', importance: 3, confidence: 'doubtful', perceptions: [at(1), at(6)] }], revise: [{ id: honest, contradicted_by: [at(4)], confidence: 'doubtful' }], drop: [] }
    expect(problems(proposal)).toEqual([])
    session.edit(editOf(7, session.characters.getBySourceId('clara')!, proposal, named))
    const added = session.memories.list(id('clara')).find(entry => entry.text.startsWith('Arthur'))!
    expect(added.confidence).toBe('doubtful')
    expect(session.memories.evidenceOf(added.id).map(entry => [entry.perceptionId, entry.relation])).toEqual([[at(1), 'supports'], [at(6), 'supports']])
    expect(session.memories.get(honest)?.confidence).toBe('doubtful')
    expect(session.memories.evidenceOf(honest)).toEqual([{ memoryId: honest, perceptionId: at(4), relation: 'contradicts', turn: 7 }])
    expect(session.memories.evidenceIndex(id('clara')).disputed).toEqual(new Set([honest]))
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

describe('what a belief is pointed at', () => {
  const seen = (id: number, involves: number[], content = '') => ({ perception: { id, content }, event: { involves } }) as never
  const belief = (about: number[], text = '') => ({ about, text }) as never

  it('is the latest few things taken in that involve the people the belief is about', () => {
    const fresh = [seen(1, [7]), seen(2, [8]), seen(3, [7, 9]), seen(4, [7]), seen(5, [7]), seen(6, [7])]
    expect(bearingOn(belief([7]), fresh)).toEqual([3, 4, 5, 6])
    expect(bearingOn(belief([9]), fresh)).toEqual([3])
  })

  it('points at nothing for a belief that is about nobody and shares nothing, or when nothing concerns it', () => {
    expect(bearingOn(belief([]), [seen(1, [7])])).toEqual([])
    expect(bearingOn(belief([5]), [seen(1, [7])])).toEqual([])
  })

  it('also points at what shares words with a belief that is about no one in particular, but not at words every sentence uses', () => {
    const fresh = [
      seen(1, [], 'Clara pours drinks for the regulars'),
      seen(2, [], 'A fisherman says the ridge path has been washed out and the boat drifts empty'),
      seen(3, [], 'Clara pours another round for the regulars'),
    ]
    expect(bearingOn(belief([], 'Harlan took the boat along the ridge path'), fresh)).toEqual([2])
    expect(bearingOn(belief([], 'That is what they said about the regulars'), fresh)).toEqual([])
  })

  it('points at what shares words even when everything taken in is about the same subject', () => {
    const fresh = [seen(1, [], 'the boat is tied at the dock'), seen(2, [], 'nobody took the boat out'), seen(3, [], 'the boat has dry oars')]
    expect(bearingOn(belief([], 'Harlan took the boat out'), fresh)).toEqual([2])
  })

  it('points first at the people, then fills what is left with what shares words', () => {
    const fresh = [seen(1, [3], 'a'), seen(2, [], 'the ridge path is washed out'), seen(3, [3], 'b')]
    expect(bearingOn(belief([3], 'the ridge path is open'), fresh)).toEqual([1, 2, 3])
  })
})

describe('the check of one belief', () => {
  const shown = {
    perceptions: new Map([[10, { perception: { id: 10 }, event: { turn: 5 } }], [11, { perception: { id: 11 }, event: { turn: 1 } }]]),
    beliefs: new Map(),
  } as unknown as Shown
  const belief = { id: 1, turn: 2 } as never
  const problem = (answer: Partial<CheckAnswer>) => checkProblem({ reason: 'they cannot both hold', things: [], verdict: 'consistent', ...answer }, belief, shown, new Set([10, 11]))

  it('takes a reason and a verdict, and a consistent belief names no thing', () => {
    expect(problem({})).toBeUndefined()
    expect(problem({ reason: ' ' })).toContain('in a sentence')
    expect(problem({ verdict: 'maybe' as never })).toContain('consistent or contradicted')
    expect(problem({ things: [10] })).toContain('names none')
  })

  it('needs the things that contradict, from the ones listed and from after the belief was formed', () => {
    expect(problem({ verdict: 'contradicted' })).toContain('name the things')
    expect(problem({ verdict: 'contradicted', things: [99] })).toContain('numbered 99')
    expect(problem({ verdict: 'contradicted', things: [11] })).toContain('before the belief')
    expect(problem({ verdict: 'contradicted', things: [10] })).toBeUndefined()
  })
})

describe('doubts found by the checks', () => {
  const none = { add: [], revise: [], drop: [] }

  it('doubts every contradiction found, in place of what the pass itself would do to that belief', () => {
    const found = [{ belief: 1, things: [10] }]
    const merged = withDoubts({ ...none, revise: [{ id: 1, importance: 3 }, { id: 3, importance: 2 }], drop: [{ id: 1, perceptions: [10] }, { id: 4, perceptions: [11] }], doubt: [{ id: 1, contradicted_by: [11] }, { id: 5, contradicted_by: [11] }] }, found)
    expect(merged.revise).toEqual([{ id: 3, importance: 2 }])
    expect(merged.drop).toEqual([{ id: 4, perceptions: [11] }])
    expect(merged.doubt).toEqual([{ id: 5, contradicted_by: [11] }, { id: 1, contradicted_by: [10] }])
  })

  it('leaves a proposal as it is when nothing was found', () => {
    const proposal = { ...none, drop: [{ id: 2, perceptions: [10] }] }
    expect(withDoubts(proposal, [])).toBe(proposal)
  })
})

describe('mending a proposal instead of refusing it', () => {
  const perception = (id: number, turn: number, importance = 2) => [id, { perception: { id }, event: { turn, importance } }] as const
  const shown = {
    perceptions: new Map([perception(1, 3), perception(2, 3), perception(3, 4), perception(4, 3, 4), perception(5, 1)]),
    beliefs: new Map([[7, { id: 7, turn: 3, confidence: 'likely', about: [] }], [8, { id: 8, turn: 3, confidence: 'sure', about: [] }]]),
    supportTurns: new Map([[7, new Set([3])], [8, new Set([3, 4])]]),
  } as unknown as Shown
  const resolve = (name: string) => (name === 'Clara' ? 'clara' : undefined)
  const belief = (perceptions: number[], extra: object = {}) => ({ kind: 'belief', text: 'x', importance: 3, perceptions, ...extra })
  const settle = (proposal: Partial<Proposal>) => settleProposal({ add: [], revise: [], drop: [], ...proposal }, shown, resolve)

  it('leaves out new beliefs that rest on one passing moment, keeping those on two turns or on one decisive event', () => {
    expect(settle({ add: [belief([1, 2]), belief([1, 3]), belief([4])] }).add.map(entry => entry.perceptions)).toEqual([[1, 3], [4]])
  })

  it('takes out of a new belief what was not shown, names that are not characters, and sureness one turn cannot carry', () => {
    const [added] = settle({ add: [belief([1, 3, 99], { about: ['Clara', 'Nobody'], confidence: 'sure', importance: 9, kind: 'rumour' })] }).add
    expect(added).toMatchObject({ perceptions: [1, 3], about: ['Clara'], confidence: 'sure', importance: 5, kind: 'belief' })
    expect(settle({ add: [belief([4], { confidence: 'sure' })] }).add[0]!.confidence).toBe('likely')
  })

  it('drops changes to beliefs that do not exist, and keeps the first change to a belief named twice', () => {
    const settled = settle({ revise: [{ id: 99, importance: 2 }, { id: 7, importance: 2 }], drop: [{ id: 7, perceptions: [3] }, { id: 98, perceptions: [3] }] })
    expect(settled.revise.map(change => change.id)).toEqual([7])
    expect(settled.drop).toEqual([])
  })

  it('keeps only evidence from after the belief, and drops a doubt or a drop left with none', () => {
    const settled = settle({ doubt: [{ id: 7, contradicted_by: [3, 5] }, { id: 8, contradicted_by: [5] }], drop: [{ id: 99, perceptions: [3] }] })
    expect(settled.doubt).toEqual([{ id: 7, contradicted_by: [3] }])
  })

  it('mends a confidence that does not match the evidence: lowered for a contradiction, left alone for nothing against it', () => {
    expect(settle({ revise: [{ id: 7, contradicted_by: [3], confidence: 'sure' }] }).revise[0]!.confidence).toBe('doubtful')
    expect(settle({ revise: [{ id: 8, importance: 2, confidence: 'doubtful' }] }).revise[0]!.confidence).toBeUndefined()
  })

  it('shortens a new belief that is too long at the end of a sentence, and keeps an existing belief\'s words when its rewrite is too long', () => {
    const long = `${'First sentence here. '.repeat(10)}${'x'.repeat(200)}`
    const settled = settle({ add: [belief([1, 3], { text: long })], revise: [{ id: 7, importance: 4, text: long }], doubt: [{ id: 8, contradicted_by: [3], text: long }] })
    expect(settled.add[0]!.text.length).toBeLessThanOrEqual(300)
    expect(settled.add[0]!.text.endsWith('here.')).toBe(true)
    expect(settled.revise[0]).not.toHaveProperty('text')
    expect(settled.doubt?.[0]).not.toHaveProperty('text')
  })

  it('leaves a proposal that is sound as it is, and keeps within the limits of a pass', () => {
    const many = Array.from({ length: 6 }, () => belief([1, 3]))
    expect(settle({ add: many }).add).toHaveLength(4)
    expect(proposalProblems(settle({ add: [belief([1, 3])], revise: [{ id: 7, importance: 4, perceptions: [3] }] }), shown, resolve)).toEqual([])
  })
})
