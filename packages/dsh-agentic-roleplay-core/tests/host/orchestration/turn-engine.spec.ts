import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Boundaries, RoundRecord } from '../../../src/host/orchestration/boundaries.ts'
import { defaultBoundaries, everyoneActs } from '../../../src/host/orchestration/defaults.ts'
import type { Outcome } from '../../../src/host/orchestration/protocol.ts'
import { TurnEngine, type RawSegment, type RunAnswer, type RunCharacter, type TurnOwner } from '../../../src/host/orchestration/turn-engine.ts'
import { DEFAULT_SETTINGS } from '../../../src/shared/settings.ts'
import { alice, arthur, bob, carol, dan, fakeStore, location, placed, scriptedRunner, type FakeStore } from './fixtures.ts'

/** The default settings, with no suggestions asked of the game master. */
const QUIET = { ...DEFAULT_SETTINGS, preview: { enabled: false }, suggestions: { count: 0 } }
const signal = new AbortController().signal
const owner: TurnOwner = { chat: 'session-1', turn: 1 }
const situation = 'Arthur opens the vault door.'
/** A different moment for every number: the same words with a counter would be the same situation. */
const moment = (number: number): string => `${situation} ${Array.from({ length: 5 }, (_, word) => Array.from({ length: 6 }, (_, letter) => String.fromCharCode(97 + ((number + 3) * (word + 5) * (letter + 7) + word * 11 + letter * letter * number) % 26)).join('')).join(' ')}`

let boundaries: Boundaries
let store: FakeStore
let engine: TurnEngine

beforeEach(() => {
  boundaries = defaultBoundaries()
  store = fakeStore([arthur, alice, bob, carol, dan])
  engine = new TurnEngine(() => boundaries, chat => (chat === 'session-1' ? store : undefined))
})

const outcome = (character: string, result: Outcome['result'], summary = `${character} ${result}`, publicState?: string): Outcome =>
  ({ character, result, summary, ...(publicState === undefined ? {} : { publicState }) })

const keys = ['alice', 'bob', 'carol', 'dan']
const calm = Object.fromEntries(keys.map(key => [key, { intent: `${key} waits`, commitment: 'low' as const }]))
const narration = (text = 'Time passes.'): RawSegment[] => [{ type: 'narration', text }]

describe('activating the characters', () => {
  it('asks every character the player does not control, all with the same situation', async () => {
    const { run, requests } = scriptedRunner({
      alice: { intent: 'a', commitment: 'high' }, bob: { intent: 'b', commitment: 'low' },
      carol: { intent: 'c', commitment: 'medium' }, dan: { intent: 'd', commitment: 'high' },
    })
    const attempt = await engine.activate(owner, { situation }, run, signal)
    expect(attempt.attempt).toBe(1)
    expect(attempt.reports.map(report => [report.character, report.name, report.intent, report.commitment])).toEqual([
      ['alice', 'Alice', 'a', 'high'], ['bob', 'Bob', 'b', 'low'], ['carol', 'Carol', 'c', 'medium'], ['dan', 'Dan', 'd', 'high'],
    ])
    expect(requests.map(request => request.member.key).sort()).toEqual(keys)
    expect(new Set(requests.map(request => request.situation))).toEqual(new Set([situation]))
    expect(requests.every(request => request.attempt === 1 && request.reaction === undefined && request.earlier === undefined)).toBe(true)
  })

  it('asks only the characters it is told to', async () => {
    const { run, requests } = scriptedRunner({ bob: { intent: 'b', commitment: 'low' } })
    await engine.activate(owner, { situation, characters: ['bob'] }, run, signal)
    expect(requests.map(request => request.member.key)).toEqual(['bob'])
  })

  it('refuses a character that cannot act on its own, naming who can', async () => {
    const { run } = scriptedRunner({})
    await expect(engine.activate(owner, { situation, characters: ['arthur'] }, run, signal)).rejects.toThrow(/cannot activate arthur.*available: alice, bob, carol, dan/)
    await expect(engine.activate(owner, { situation, characters: ['nobody'] }, run, signal)).rejects.toThrow(/cannot activate nobody/)
  })

  it('refuses an empty situation, an activation while a round is open and a chat that is not a roleplay session', async () => {
    const { run } = scriptedRunner(calm)
    await expect(engine.activate(owner, { situation: '  ' }, run, signal)).rejects.toThrow(/describe the situation/)
    await expect(engine.activate({ chat: 'other', turn: 1 }, { situation }, run, signal)).rejects.toThrow(/not a roleplay session/)
    await engine.activate(owner, { situation }, run, signal)
    await expect(engine.activate(owner, { situation }, run, signal)).rejects.toThrow(/already acted.*resolve_round/)
  })

  it('reports a character that fails or answers badly and goes on with the rest', async () => {
    boundaries.outputValidator = { validate: ({ intent }) => (intent === 'nonsense' ? { ok: false, reason: 'that is not an intent' } : { ok: true }) }
    const { run } = scriptedRunner({
      alice: { intent: 'a', commitment: 'low' }, bob: new Error('model unavailable'),
      carol: { intent: 'nonsense', commitment: 'low' }, dan: { intent: 'd', commitment: 'low' },
    })
    const attempt = await engine.activate(owner, { situation }, run, signal)
    expect(attempt.reports.map(report => report.character)).toEqual(['alice', 'dan'])
    expect(attempt.failures).toEqual([
      { character: 'bob', name: 'Bob', reason: 'model unavailable', technical: true },
      { character: 'carol', name: 'Carol', reason: 'that is not an intent' },
    ])
  })

  it('puts the reason of a fault of the system in the log, where the story cannot read it', async () => {
    const logged: string[] = []
    engine = new TurnEngine(() => boundaries, chat => (chat === 'session-1' ? store : undefined), (message) => { logged.push(message) })
    const { run } = scriptedRunner({ alice: new Error('model unavailable'), bob: { intent: 'b', commitment: 'low' } })
    await engine.activate(owner, { situation, characters: ['alice', 'bob'] }, run, signal)
    expect(logged).toEqual(['Alice could not act: model unavailable'])
  })

  it('lets the game master try again when nobody could act', async () => {
    const { run } = scriptedRunner({ alice: new Error('down'), bob: new Error('down'), carol: new Error('down'), dan: new Error('down') })
    const attempt = await engine.activate(owner, { situation }, run, signal)
    expect(attempt.reports).toEqual([])
    expect(engine.missing(owner)).toMatch(/call activate_characters/)
    expect((await engine.activate(owner, { situation }, scriptedRunner(calm).run, signal)).reports).toHaveLength(4)
  })

  it('does not swallow a cancellation', async () => {
    const controller = new AbortController()
    const run = () => { controller.abort(); return Promise.reject(new Error('aborted')) }
    await expect(engine.activate(owner, { situation }, run, controller.signal)).rejects.toThrow('aborted')
  })
})

describe('a round where A goes through, B wins over C and D, C gives up and D tries again', () => {
  const first = {
    alice: { intent: 'Alice takes the lantern', commitment: 'medium' as const },
    bob: { intent: 'Bob takes the key', commitment: 'high' as const },
    carol: { intent: 'Carol takes the key', commitment: 'low' as const },
    dan: { intent: 'Dan takes the key', commitment: 'high' as const },
  }

  it('retries only the committed character whose intent failed, with everything that happened', async () => {
    const runner = scriptedRunner({ ...first, dan: [first.dan, { intent: 'Dan grabs the lantern instead', commitment: 'medium' }] })
    await engine.activate(owner, { situation }, runner.run, signal)
    const resolution = await engine.resolve(owner, [
      outcome('alice', 'succeeded', 'Alice has the lantern'),
      outcome('bob', 'succeeded', 'Bob has the key', 'holding a brass key'),
      outcome('carol', 'failed', 'Bob got there first'),
      outcome('dan', 'failed', 'Bob pushed Dan aside'),
    ], runner.run, signal)

    expect(resolution.done).toBeUndefined()
    expect(resolution.next?.attempt).toBe(2)
    expect(resolution.next?.reports.map(report => [report.character, report.intent])).toEqual([['dan', 'Dan grabs the lantern instead']])
    const retry = runner.requests.at(-1)
    expect(runner.requests.filter(request => request.member.key === 'carol')).toHaveLength(1)
    expect(retry?.attempt).toBe(2)
    expect(retry?.previous).toEqual(first.dan)
    expect(retry?.reaction?.map(entry => [entry.character, entry.result])).toEqual([
      ['alice', 'succeeded'], ['bob', 'succeeded'], ['carol', 'failed'], ['dan', 'failed'],
    ])
    expect(retry?.reaction?.find(entry => entry.character === 'carol')?.summary).toBe('Bob got there first')
    expect(engine.missing(owner)).toMatch(/resolve_round once more.*dan/)

    const done = await engine.resolve(owner, [outcome('dan', 'succeeded', 'Dan has the lantern too')], runner.run, signal)
    expect(done.done?.updated.sort()).toEqual(keys)
    expect(store.commits).toHaveLength(1)
    const patches = Object.fromEntries(store.commits[0]?.map(update => [update.character, update.patch]) ?? [])
    expect(Object.values(patches)).toHaveLength(4)
    expect(Object.values(patches)).toContainEqual({ activity: 'Dan has the lantern too' })
    expect(Object.values(patches)).toContainEqual({ activity: 'Bob has the key', publicState: 'holding a brass key' })
    expect(Object.values(patches)).toContainEqual({ activity: 'Bob got there first' })
    expect(store.completed).toBe(0)
    expect(engine.missing(owner)).toMatch(/call narrate/)
  })

  it('does not retry a second time: what is decided on the retry is final', async () => {
    const runner = scriptedRunner({ ...first, dan: [first.dan, { intent: 'again', commitment: 'high' }] })
    await engine.activate(owner, { situation }, runner.run, signal)
    await engine.resolve(owner, [outcome('alice', 'succeeded'), outcome('bob', 'succeeded'), outcome('carol', 'failed'), outcome('dan', 'failed')], runner.run, signal)
    const done = await engine.resolve(owner, [outcome('dan', 'failed', 'Dan fails again')], runner.run, signal)
    expect(done.done).toBeDefined()
    expect(runner.requests.filter(request => request.member.key === 'dan')).toHaveLength(2)
  })

  it('records the round straight away when nobody has to retry', async () => {
    const runner = scriptedRunner(first)
    await engine.activate(owner, { situation }, runner.run, signal)
    const resolution = await engine.resolve(owner, [outcome('alice', 'succeeded'), outcome('bob', 'succeeded'), outcome('carol', 'partial'), outcome('dan', 'partial')], runner.run, signal)
    expect(resolution.done?.updated).toHaveLength(4)
    expect(runner.requests).toHaveLength(4)
  })

  it('records the first attempt when every retry fails to run, and says so', async () => {
    const runner = scriptedRunner({ ...first, dan: [first.dan] })
    await engine.activate(owner, { situation }, runner.run, signal)
    const resolution = await engine.resolve(owner, [outcome('alice', 'succeeded'), outcome('bob', 'succeeded'), outcome('carol', 'failed'), outcome('dan', 'failed', 'Dan is blocked')], runner.run, signal)
    expect(resolution.done?.retryFailures.map(failure => failure.character)).toEqual(['dan'])
    expect(store.commits[0]).toHaveLength(4)
  })
})

describe('resolving', () => {
  it('refuses outcomes that do not cover exactly the characters that acted, and keeps waiting', async () => {
    const runner = scriptedRunner(calm)
    await expect(engine.resolve(owner, [outcome('alice', 'succeeded')], runner.run, signal)).rejects.toThrow(/call activate_characters first/)
    await engine.activate(owner, { situation }, runner.run, signal)
    await expect(engine.resolve(owner, [outcome('alice', 'succeeded'), outcome('alice', 'failed'), outcome('ghost', 'failed')], runner.run, signal))
      .rejects.toThrow(/missing an outcome for bob.*ghost is not waiting.*more than one outcome for alice.*expected exactly: alice, bob, carol, dan/)
    await expect(engine.resolve(owner, keys.map(key => outcome(key, 'succeeded', ' ')), runner.run, signal)).rejects.toThrow(/say what happens/)
    expect(store.commits).toEqual([])
    expect(engine.missing(owner)).toMatch(/resolve_round with one outcome for each of: alice, bob, carol, dan/)
  })

  it('does not accept a resolution once the round is recorded', async () => {
    const runner = scriptedRunner(calm)
    await engine.activate(owner, { situation }, runner.run, signal)
    await engine.resolve(owner, keys.map(key => outcome(key, 'succeeded')), runner.run, signal)
    await expect(engine.resolve(owner, [outcome('alice', 'succeeded')], runner.run, signal)).rejects.toThrow(/already recorded.*activate_characters again.*narrate/)
  })
})

describe('several rounds in one turn', () => {
  const lines = {
    alice: [{ intent: 'Alice greets Arthur', utterance: 'Welcome back.', commitment: 'low' as const }, { intent: 'Alice answers Bob', utterance: 'Not now, Bob.', commitment: 'low' as const }],
    bob: [{ intent: 'Bob reacts', utterance: 'Why is he here?', commitment: 'low' as const }],
  }
  /** The runner takes its answers off these lists, so each test gets its own copy. */
  const answers = () => ({ alice: [...lines.alice], bob: [...lines.bob] })

  async function twoRounds() {
    const runner = scriptedRunner(answers())
    await engine.activate(owner, { situation: 'Arthur enters.', characters: ['alice'] }, runner.run, signal)
    await engine.resolve(owner, [outcome('alice', 'succeeded', 'Alice greets him', 'smiling')], runner.run, signal)
    await engine.activate(owner, { situation: 'Alice has greeted Arthur.', characters: ['bob'] }, runner.run, signal)
    await engine.resolve(owner, [outcome('bob', 'succeeded', 'Bob objects')], runner.run, signal)
    return runner
  }

  it('lets the game master ask the characters again after a round, telling them what happened before', async () => {
    const runner = await twoRounds()
    const second = runner.requests.find(request => request.member.key === 'bob')
    expect(second?.earlier).toEqual([
      { round: 1, character: 'alice', name: 'Alice', intent: 'Alice greets Arthur', utterance: 'Welcome back.', result: 'succeeded', summary: 'Alice greets him' },
    ])
    expect(runner.requests.find(request => request.member.key === 'alice')?.earlier).toBeUndefined()
    expect(store.commits).toHaveLength(2)
    await engine.activate(owner, { situation: 'Bob has objected.', characters: ['alice'] }, runner.run, signal)
    expect(runner.requests.at(-1)?.earlier?.map(entry => [entry.round, entry.character])).toEqual([[1, 'alice'], [2, 'bob']])
  })

  it('keeps what was said in every round, in order, and a character can speak again', async () => {
    const runner = await twoRounds()
    await engine.activate(owner, { situation: 'Bob has objected.', characters: ['alice'] }, runner.run, signal)
    const done = await engine.resolve(owner, [outcome('alice', 'succeeded', 'Alice cuts him off')], runner.run, signal)
    expect(done.done?.round).toBe(3)
    expect(done.done?.utterances).toEqual([{ character: 'alice', name: 'Alice', text: 'Not now, Bob.', round: 3 }])
    expect(done.done?.spoken.map(utterance => [utterance.round, utterance.character, utterance.text])).toEqual([
      [1, 'alice', 'Welcome back.'], [2, 'bob', 'Why is he here?'], [3, 'alice', 'Not now, Bob.'],
    ])
    expect(engine.missing(owner)).toMatch(/call narrate.*Alice: "Welcome back\."/)
  })

  it('refuses another round once the limit of the chat is reached, and says to deliver', async () => {
    store.maxRounds = 2
    const runner = await twoRounds()
    expect(engine.missing(owner)).not.toMatch(/call activate_characters/)
    await expect(engine.activate(owner, { situation: 'More.', characters: ['alice'] }, runner.run, signal)).rejects.toThrow(/2 rounds of characters were already played.*most this chat allows.*narrate/)
    expect(runner.requests).toHaveLength(2)
  })

  it('reads the limit again at each round, so a change in the settings applies at once', async () => {
    store.maxRounds = 1
    const runner = scriptedRunner(answers())
    await engine.activate(owner, { situation: 'Arthur enters.', characters: ['alice'] }, runner.run, signal)
    const done = await engine.resolve(owner, [outcome('alice', 'succeeded')], runner.run, signal)
    expect(done.done?.limit).toBe(1)
    await expect(engine.activate(owner, { situation: 'More.', characters: ['bob'] }, runner.run, signal)).rejects.toThrow(/most this chat allows/)
    store.maxRounds = 3
    await expect(engine.activate(owner, { situation: 'More.', characters: ['bob'] }, runner.run, signal)).resolves.toBeDefined()
  })

  it('says how many rounds are left while the game master decides', async () => {
    store.maxRounds = 3
    const runner = scriptedRunner(answers())
    await engine.activate(owner, { situation: 'Arthur enters.', characters: ['alice'] }, runner.run, signal)
    await engine.resolve(owner, [outcome('alice', 'succeeded')], runner.run, signal)
    expect(engine.missing(owner)).toMatch(/or call activate_characters if the story genuinely needs them again \(2 round\(s\) left\)/)
  })

  it('counts the turn once, when its output is delivered, not per round', async () => {
    const runner = await twoRounds()
    expect(store.completed).toBe(0)
    await engine.narrate(owner, [
      { type: 'utterance', character: 'alice', text: 'Welcome back.' },
      { type: 'utterance', character: 'bob', text: 'Why is he here?' },
    ])
    expect(store.completed).toBe(1)
    expect(engine.missing(owner)).toBeUndefined()
    await expect(engine.activate(owner, { situation: 'Again.' }, runner.run, signal)).rejects.toThrow(/already recorded/)
  })

  it('starts over with the next turn: no earlier rounds, a fresh count', async () => {
    const runner = await twoRounds()
    store.maxRounds = 2
    const next = { chat: 'session-1', turn: 2 }
    const fresh = scriptedRunner({ alice: [{ ...lines.alice[0]! }] })
    await engine.activate(next, { situation: 'A new turn.', characters: ['alice'] }, fresh.run, signal)
    expect(fresh.requests[0]?.earlier).toBeUndefined()
    expect(runner.requests).toHaveLength(2)
  })
})

describe('delivering the output', () => {
  const voices = {
    alice: { intent: 'Alice stands and walks to the door', utterance: 'That is not something I expected.', commitment: 'low' as const },
    bob: { intent: 'Bob looks at the player, trying to tell if he is serious', commitment: 'low' as const },
    carol: { intent: 'Carol laughs', utterance: 'Oh, please.', commitment: 'low' as const },
    dan: { intent: 'Dan grabs the key', utterance: 'Mine!', commitment: 'high' as const },
  }
  const said = { type: 'utterance' as const }

  async function recorded(overrides: Record<string, Outcome> = {}, answers: Parameters<typeof scriptedRunner>[0] = voices) {
    const runner = scriptedRunner(answers)
    await engine.activate(owner, { situation }, runner.run, signal)
    const resolution = await engine.resolve(owner, keys.map(key => overrides[key] ?? outcome(key, 'succeeded')), runner.run, signal)
    return { runner, resolution }
  }

  it('asks every utterance of those who spoke to be carried by the output, in the order they acted', async () => {
    const { resolution } = await recorded()
    expect(resolution.done?.spoken).toEqual([
      { character: 'alice', name: 'Alice', text: 'That is not something I expected.', round: 1 },
      { character: 'carol', name: 'Carol', text: 'Oh, please.', round: 1 },
      { character: 'dan', name: 'Dan', text: 'Mine!', round: 1 },
    ])
  })

  it('does not ask for the words of a character the game master says could not speak', async () => {
    const { resolution } = await recorded({ carol: { character: 'carol', result: 'failed', summary: 'Carol is silenced', spoken: false } })
    expect(resolution.done?.spoken.map(utterance => utterance.character)).toEqual(['alice', 'dan'])
  })

  it('takes the retry\'s words in place of the first attempt\'s', async () => {
    const runner = scriptedRunner({ ...voices, dan: [voices.dan, { intent: 'Dan reaches again', utterance: 'Give it here!', commitment: 'medium' }] })
    await engine.activate(owner, { situation }, runner.run, signal)
    await engine.resolve(owner, keys.map(key => outcome(key, key === 'dan' ? 'failed' : 'succeeded')), runner.run, signal)
    expect(runner.requests.at(-1)?.reaction?.find(entry => entry.character === 'carol')?.utterance).toBe('Oh, please.')
    const done = await engine.resolve(owner, [outcome('dan', 'succeeded')], runner.run, signal)
    expect(done.done?.spoken.map(utterance => utterance.text)).toEqual(['That is not something I expected.', 'Oh, please.', 'Give it here!'])
  })

  it('accepts narration between and after the utterances, in the order the game master gives', async () => {
    await recorded()
    const output = await engine.narrate(owner, [
      { ...said, character: 'alice', text: 'That is not something I expected.' },
      { type: 'narration', text: 'Alice stands and walks to the door while Bob stares at you.' },
      { ...said, character: 'carol', text: '"Oh, please."' },
      { ...said, character: 'dan', text: 'Mine!' },
      { type: 'narration', text: 'The key glints between them.' },
    ])
    expect(output.repaired).toBe(false)
    expect(output.segments.map(segment => (segment.type === 'utterance' ? `${segment.name}:${segment.text}` : segment.text))).toEqual([
      'Alice:That is not something I expected.', 'Alice stands and walks to the door while Bob stares at you.', 'Carol:Oh, please.', 'Dan:Mine!', 'The key glints between them.',
    ])
    expect(engine.missing(owner)).toBeUndefined()
    expect(store.completed).toBe(1)
  })

  it('refuses an output that changes, drops or invents an utterance, and says exactly what is wrong', async () => {
    await recorded()
    await expect(engine.narrate(owner, [
      { ...said, character: 'alice', text: 'This is unexpected.' },
      { ...said, character: 'bob', text: 'Hm.' },
      { ...said, character: 'dan', text: 'Mine!' },
      { ...said, character: 'dan', text: 'Mine!' },
    ])).rejects.toThrow(/segment 1: the utterance of Alice was changed.*"That is not something I expected\."; segment 2: bob has nothing to say.*invented; remove it; segment 4: Dan has no more utterances to say.*the utterance of Carol is missing.*"Oh, please\."/)
    expect(engine.missing(owner)).toMatch(/call narrate/)
    expect(store.completed).toBe(0)
  })

  it('refuses an utterance with no speaker', async () => {
    await recorded()
    await expect(engine.narrate(owner, [{ type: 'utterance', text: 'Hello' }])).rejects.toThrow(/needs the character who says it/)
  })

  it('corrects the output itself once the game master was asked twice', async () => {
    await recorded()
    const wrong: RawSegment[] = [{ ...said, character: 'alice', text: 'Something else.' }, { type: 'narration', text: 'Things happen.' }]
    await expect(engine.narrate(owner, wrong)).rejects.toThrow()
    await expect(engine.narrate(owner, wrong)).rejects.toThrow()
    const output = await engine.narrate(owner, wrong)
    expect(output.repaired).toBe(true)
    expect(output.segments.filter(segment => segment.type === 'utterance').map(segment => segment.type === 'utterance' && segment.text)).toEqual([
      'That is not something I expected.', 'Oh, please.', 'Mine!',
    ])
    expect(output.segments).toContainEqual({ type: 'narration', text: 'Things happen.' })
    expect(engine.missing(owner)).toBeUndefined()
  })

  it('needs an output even when nobody spoke, and refuses one before a round is recorded', async () => {
    await expect(engine.narrate(owner, narration())).rejects.toThrow(/nothing to deliver yet: call activate_characters to let the characters act, or, when nobody else needs to react, call resolve_round/)
    const runner = scriptedRunner(calm)
    await engine.activate(owner, { situation }, runner.run, signal)
    await expect(engine.narrate(owner, narration())).rejects.toThrow(/resolve the round first/)
    const resolution = await engine.resolve(owner, keys.map(key => outcome(key, 'succeeded')), runner.run, signal)
    expect(resolution.done?.spoken).toEqual([])
    expect(engine.missing(owner)).toMatch(/call narrate with the output of the turn/)
    expect((await engine.narrate(owner, narration('Nothing happens.'))).repaired).toBe(false)
  })

  it('asks a narrator to write the output when the game master gives no segments, and checks it', async () => {
    boundaries.narrator = { narrate: input => Promise.resolve([{ type: 'narration', text: `${input.situations.length} round about ${input.utterances.length} utterances` }]) }
    await recorded()
    const output = await engine.narrate(owner, [])
    expect(output.repaired).toBe(true)
    expect(output.segments.filter(segment => segment.type === 'utterance')).toHaveLength(3)
    expect(output.segments.find(segment => segment.type === 'narration')).toEqual({ type: 'narration', text: '1 round about 3 utterances' })
  })

  it('asks for segments when there is no narrator to write them', async () => {
    await recorded()
    await expect(engine.narrate(owner, [])).rejects.toThrow(/give its segments/)
  })

  it('has a checker boundary that can be replaced', async () => {
    boundaries.narrationChecker = { check: () => [], repair: segments => [...segments] }
    await recorded()
    expect((await engine.narrate(owner, narration('No one is heard.'))).repaired).toBe(false)
  })
})

describe('writing the records', () => {
  const voices = { alice: { intent: 'a', utterance: 'Hello.', commitment: 'low' as const } }
  let asked = 0
  const only = (runner: ReturnType<typeof scriptedRunner>) => engine.activate(owner, { situation: moment(asked++), characters: ['alice'] }, runner.run, signal)
  const aliceSucceeds = [outcome('alice', 'succeeded', 'Alice greets him', 'smiling')]
  const hello = [{ type: 'utterance' as const, character: 'alice', text: 'Hello.' }]
  let problems: string[]
  let written: string[]

  beforeEach(() => {
    asked = 0
    problems = []
    written = []
    engine = new TurnEngine(() => boundaries, chat => (chat === 'session-1' ? store : undefined), (message) => { problems.push(message) }, (chat) => { written.push(chat) })
  })

  /** One round of Alice, resolved. */
  const play = async (runner = scriptedRunner(voices)) => {
    await only(runner)
    await engine.resolve(owner, aliceSucceeds, runner.run, signal)
    return runner
  }

  it('queues each round durably and writes nothing until the game master asks', async () => {
    let calls = 0
    boundaries.committer = { commit: () => { calls += 1; return Promise.resolve({ writes: 1, notes: '' }) } }
    await play()
    await engine.flush(owner)
    expect(store.queue).toHaveLength(1)
    expect(engine.waiting(owner)).toBe(1)
    expect(calls).toBe(0)
    await engine.narrate(owner, hello)
    expect(calls).toBe(0)
    expect(store.completed).toBe(1)
    expect(store.queue).toHaveLength(1)
    expect(written).toEqual([])
  })

  it('applies what the game master decided about each character at once, without the keeper', async () => {
    await play()
    expect(store.commits).toHaveLength(1)
    expect(store.commits[0]?.[0]?.patch).toEqual({ activity: 'Alice greets him', publicState: 'smiling' })
  })

  it('writes the waiting rounds in the background when asked, and the player is not kept waiting for that run', async () => {
    const started: number[] = []
    let release!: () => void
    boundaries.committer = { commit: job => new Promise((done) => { started.push(job.rounds.length); release = () => { done({ writes: 1, notes: '' }) } }) }
    await play()
    expect(engine.record(owner)).toBe(1)
    await Promise.resolve()
    expect(started).toEqual([1])
    expect(store.completed).toBe(0)
    const output = await engine.narrate(owner, hello)
    expect(output.segments).toHaveLength(1)
    expect(store.completed).toBe(1)
    expect(store.queue).toHaveLength(1)
    release()
    await engine.settle(owner.chat)
    expect(store.queue).toEqual([])
    expect(written).toEqual(['session-1'])
  })

  it('refuses to record when no round is waiting', async () => {
    expect(() => engine.record(owner)).toThrow(/nothing is waiting/)
    boundaries.committer = { commit: () => Promise.resolve({ writes: 0, notes: '' }) }
    await play()
    engine.record(owner)
    await engine.flush(owner)
    expect(() => engine.record(owner)).toThrow(/nothing is waiting/)
  })

  it('gives the keeper the rounds, with what the game master said is worth keeping', async () => {
    const jobs: Parameters<Boundaries['committer']['commit']>[0][] = []
    boundaries.committer = { commit: (job) => { jobs.push(job); return Promise.resolve({ writes: 0, notes: '' }) } }
    const runner = scriptedRunner({ ...voices, bob: { intent: 'b', commitment: 'low' } })
    await engine.activate(owner, { situation, characters: ['alice', 'bob'] }, runner.run, signal)
    await engine.resolve(owner, [aliceSucceeds[0]!, { ...outcome('bob', 'failed', 'Bob is stopped'), spoken: false }], runner.run, signal)
    engine.record(owner, '  Bob was stopped at the door  ')
    await engine.flush(owner)
    const [round] = jobs[0]!.rounds
    expect(jobs[0]).toMatchObject({ chat: 'session-1', store, focus: ['Bob was stopped at the door'] })
    expect(round).toMatchObject({ turn: 1, round: 1, situation })
    expect(round?.entries.find(entry => entry.character === 'alice')).toEqual({
      character: 'alice', name: 'Alice', intent: 'a', utterance: 'Hello.', commitment: 'low', result: 'succeeded', summary: 'Alice greets him', publicState: 'smiling', spoken: true,
    })
  })

  it('writes every round still waiting, from earlier turns as well, in one run', async () => {
    const seen: number[][] = []
    boundaries.committer = { commit: ({ rounds }) => { seen.push(rounds.map(round => round.turn * 10 + round.round)); return Promise.resolve({ writes: 1, notes: '' }) } }
    const runner = scriptedRunner({ alice: [voices.alice, { ...voices.alice }, { ...voices.alice }] })
    await play(runner)
    await engine.narrate(owner, hello)
    const second = { chat: 'session-1', turn: 2 }
    await engine.activate(second, { situation, characters: ['alice'] }, runner.run, signal)
    await engine.resolve(second, aliceSucceeds, runner.run, signal)
    await engine.activate(second, { situation: moment(491), characters: ['alice'] }, runner.run, signal)
    await engine.resolve(second, aliceSucceeds, runner.run, signal)
    expect(engine.waiting(second)).toBe(3)
    engine.record(second, 'the second turn')
    await engine.flush(second)
    expect(seen).toEqual([[11, 21, 22]])
    expect(store.queue).toEqual([])
  })

  it('writes one run at a time, so asking again waits for the run before', async () => {
    const order: string[] = []
    boundaries.committer = {
      commit: async ({ rounds }) => {
        order.push(`start ${rounds.map(round => round.round).join('+')}`)
        await new Promise(resolve => setTimeout(resolve, 10))
        order.push(`end ${rounds.map(round => round.round).join('+')}`)
        return { writes: 0, notes: '' }
      },
    }
    const runner = scriptedRunner({ alice: [voices.alice, { intent: 'a', commitment: 'low' as const }] })
    await play(runner)
    engine.record(owner)
    await only(runner)
    await engine.resolve(owner, aliceSucceeds, runner.run, signal)
    engine.record(owner)
    await engine.narrate(owner, hello)
    await engine.flush(owner)
    expect(order).toEqual(['start 1', 'end 1', 'start 2', 'end 2'])
    expect(store.queue).toEqual([])
  })

  it('keeps a round whose records failed, silently, and writes it with the next run', async () => {
    const seen: number[][] = []
    let fail = true
    boundaries.committer = {
      commit: ({ rounds }) => {
        seen.push(rounds.map(round => round.round))
        return fail ? Promise.reject(new Error('the model is down')) : Promise.resolve({ writes: 1, notes: '' })
      },
    }
    const runner = scriptedRunner({ alice: [voices.alice, { ...voices.alice }] })
    await play(runner)
    engine.record(owner)
    await engine.flush(owner)
    expect(store.queue.map(round => round.round)).toEqual([1])
    expect(problems).toEqual(['the records of 1.1 were not written: the model is down'])
    expect(written).toEqual([])
    fail = false
    await only(runner)
    await engine.resolve(owner, aliceSucceeds, runner.run, signal)
    engine.record(owner)
    await engine.flush(owner)
    expect(seen.at(-1)).toEqual([1, 2])
    expect(store.queue).toEqual([])
  })

  it('gives up the records of rounds that failed three runs in a row, saying so', async () => {
    boundaries.committer = { commit: () => Promise.reject(new Error('down')) }
    await play()
    for (let run = 0; run < 3; run += 1) { engine.record(owner); await engine.flush(owner) }
    expect(store.queue).toEqual([])
    expect(problems.at(-1)).toMatch(/given up after 3 failed runs/)
  })

  it('refuses to ask the same characters about the same situation twice in a turn', async () => {
    const runner = scriptedRunner({ alice: [voices.alice, { ...voices.alice }] })
    await play(runner)
    await only(runner)
    await engine.resolve(owner, aliceSucceeds, runner.run, signal)
    await expect(engine.activate(owner, { situation: moment(0), characters: ['alice'] }, runner.run, signal)).rejects.toThrow(/nothing new/)
  })

  it('also refuses a round about a situation that only differs by a few words, but not one where something happened', async () => {
    const runner = scriptedRunner({ alice: [voices.alice, { ...voices.alice }, { ...voices.alice }] })
    await play(runner)
    await only(runner)
    await engine.resolve(owner, aliceSucceeds, runner.run, signal)
    await expect(engine.activate(owner, { situation: `${moment(asked - 1)} Now!`, characters: ['alice'] }, runner.run, signal)).rejects.toThrow(/nothing new/)
    await expect(engine.activate(owner, { situation: `${situation} Behind it a lantern swings, Bob steps back and Alice demands to know who left it burning.`, characters: ['alice'] }, runner.run, signal)).resolves.toBeDefined()
  })

  it('reads a speaker sent as a segment of its own as the character of the words that follow, only when it names someone in the scene', async () => {
    await play()
    const words = (hello.find(segment => segment.type === 'utterance') as RawSegment).text
    const output = await engine.narrate(owner, [{ type: 'utterance', text: 'alice' }, { type: 'utterance', text: words }])
    expect(output).toEqual({ segments: [{ type: 'utterance', character: 'alice', name: 'Alice', text: words }], repaired: false })
  })

  it('does not guess a speaker that is not in the scene', async () => {
    await play()
    const words = (hello.find(segment => segment.type === 'utterance') as RawSegment).text
    await expect(engine.narrate(owner, [{ type: 'utterance', text: 'Nobody' }, { type: 'utterance', text: words }])).rejects.toThrow(/an utterance needs the character who says it/)
  })

  it('tries once more when the next turn starts if the records were asked for, and goes on without them when that fails too', async () => {
    let calls = 0
    boundaries.committer = { commit: () => { calls += 1; return Promise.reject(new Error('down')) } }
    await play()
    engine.record(owner)
    const output = await engine.narrate(owner, hello)
    await engine.flush(owner)
    expect(calls).toBe(1)
    await engine.settle(owner.chat)
    expect(calls).toBe(2)
    expect(output).toEqual({ segments: [expect.objectContaining({ type: 'utterance' })], repaired: false })
    expect(store.completed).toBe(1)
    expect(store.queue).toHaveLength(1)
  })

  it('retries a failed write only for a later turn: a call in the turn just delivered waits for a run in flight and starts nothing', async () => {
    let calls = 0
    boundaries.committer = { commit: () => { calls += 1; return Promise.reject(new Error('down')) } }
    await play()
    engine.record(owner)
    await engine.narrate(owner, hello)
    await engine.flush(owner)
    await engine.settle(owner.chat, owner.turn)
    expect(calls).toBe(1)
    await engine.settle(owner.chat, owner.turn + 1)
    expect(calls).toBe(2)
  })

  it('is saved by the second try when the first one failed', async () => {
    let calls = 0
    boundaries.committer = { commit: () => { calls += 1; return calls === 1 ? Promise.reject(new Error('flaky')) : Promise.resolve({ writes: 1, notes: '' }) } }
    await play()
    engine.record(owner)
    await engine.narrate(owner, hello)
    await engine.settle(owner.chat)
    expect(calls).toBe(2)
    expect(store.queue).toEqual([])
  })

  it('runs the keeper at delivery anyway once too many rounds are waiting', async () => {
    let calls = 0
    boundaries.committer = { commit: () => { calls += 1; return Promise.resolve({ writes: 1, notes: '' }) } }
    const base = store.settings
    store.settings = () => ({ ...base(), memory: { ...base().memory, backlogRounds: 2 } })
    const runner = scriptedRunner({ alice: [voices.alice, { intent: 'a', commitment: 'low' as const }] })
    await play(runner)
    await engine.activate(owner, { situation: moment(609), characters: ['alice'] }, runner.run, signal)
    await engine.resolve(owner, aliceSucceeds, runner.run, signal)
    await engine.narrate(owner, hello)
    expect(calls).toBe(1)
    expect(store.queue).toEqual([])
  })

  it('does not hold back a refused output: only a delivered one waits for the records', async () => {
    boundaries.committer = { commit: () => new Promise(() => undefined) }
    await play()
    engine.record(owner)
    await expect(engine.narrate(owner, [{ type: 'utterance', character: 'alice', text: 'Changed.' }])).rejects.toThrow(/not acceptable/)
    engine.forget('session-1')
  })
})

describe('boundaries', () => {
  it('can be replaced: a different retry policy retries other characters', async () => {
    boundaries.retryPolicy = { select: ({ reports }) => reports.filter(report => report.commitment !== 'low').map(report => report.character) }
    const runner = scriptedRunner({
      alice: [{ intent: 'a', commitment: 'medium' }, { intent: 'a again', commitment: 'low' }], bob: { intent: 'b', commitment: 'low' },
      carol: { intent: 'c', commitment: 'low' }, dan: { intent: 'd', commitment: 'low' },
    })
    await engine.activate(owner, { situation }, runner.run, signal)
    const resolution = await engine.resolve(owner, keys.map(key => outcome(key, 'succeeded')), runner.run, signal)
    expect(resolution.next?.reports.map(report => report.character)).toEqual(['alice'])
  })

  it('can give each character its own context', async () => {
    boundaries.characterContext = { brief: request => ({ persona: `persona of ${request.member.key}`, prompt: `private notes for ${request.member.key}` }) }
    const seen: string[] = []
    const run: RunCharacter = (request) => {
      seen.push(boundaries.characterContext.brief(request).prompt)
      return Promise.resolve({ intent: 'x', commitment: 'low' as const })
    }
    await engine.activate(owner, { situation }, run, signal)
    expect(seen.sort()).toEqual(keys.map(key => `private notes for ${key}`))
  })

  it('can refuse the input of the player so that no round is needed', () => {
    boundaries.inputValidator = { validate: ({ text }) => (text === 'xyzzy' ? { ok: false, reason: 'nothing happens' } : { ok: true }) }
    expect(boundaries.inputValidator.validate({ text: 'xyzzy', turn: 1, cast: [] })).toEqual({ ok: false, reason: 'nothing happens' })
    engine.skip(owner)
    expect(engine.missing(owner)).toBeUndefined()
  })

  it('has a planner that rejects duplicates', () => {
    expect(everyoneActs.plan({ cast: [arthur, alice, bob], requested: ['bob', 'bob'] })).toEqual(['bob'])
  })
})

describe('turns and objections', () => {
  it('tells the game master what is missing, and a new turn starts over', async () => {
    expect(engine.missing(owner)).toMatch(/call activate_characters/)
    await engine.activate(owner, { situation }, scriptedRunner(calm).run, signal)
    expect(engine.missing(owner)).toMatch(/resolve_round/)
    expect(engine.missing({ chat: 'session-1', turn: 2 })).toMatch(/call activate_characters/)
  })

  it('lets an agent be turned back only a few times per turn', () => {
    expect([1, 2, 3, 4, 5].map(() => engine.object(owner))).toEqual([true, true, true, false, false])
    expect(engine.object({ chat: 'session-1', turn: 2 })).toBe(true)
    engine.forget('session-1')
    expect(engine.object(owner)).toBe(true)
  })
})

describe('places', () => {
  const bar = location(1, 'The Bar')
  const cellar = location(2, 'Cellar')
  const only = { alice: { intent: 'a', utterance: 'Hello.', commitment: 'low' as const } }
  let seen: { character: string; request: unknown }[]

  beforeEach(() => {
    seen = []
    store = fakeStore([placed(arthur, bar, 'at the bar'), placed(alice, bar), placed(bob, cellar), carol, dan])
    store.checkMove = (character, request) => {
      seen.push({ character, request })
      if (request.location === 'cellar') return { ok: true, move: { to: cellar.id, ...(request.position === undefined ? {} : { position: request.position }) }, plan: { from: bar.id, to: cellar.id, via: [cellar.id] }, to: { key: 'cellar', name: 'Cellar' }, ...(request.position === undefined ? {} : { position: request.position }) }
      if (request.location === 'bar') return { ok: true, move: { to: bar.id }, plan: { from: bar.id, to: bar.id, via: [] }, to: { key: 'bar', name: 'The Bar' } }
      return { ok: false, problems: ['the way from The Bar to Vault is locked at The Bar -> Vault: needs a key'] }
    }
    store.place = id => (id === bar.id ? { key: 'bar', location: bar, exits: [], here: [placed(arthur, bar, 'at the bar'), placed(alice, bar)] } : undefined)
    engine = new TurnEngine(() => boundaries, chat => (chat === 'session-1' ? store : undefined))
  })

  const act = async (outcomes: Outcome[], runner = scriptedRunner(only)) => {
    await engine.activate(owner, { situation, characters: ['alice'] }, runner.run, signal)
    return { runner, resolution: await engine.resolve(owner, outcomes, runner.run, signal) }
  }

  it('tells each character the place it is in and who is there with it', async () => {
    const { runner } = await act([outcome('alice', 'succeeded')])
    expect(runner.requests[0]?.place?.key).toBe('bar')
    expect(runner.requests[0]?.place?.here.map(member => member.key)).toEqual(['arthur', 'alice'])
  })

  it('refuses an outcome that sends a character where it cannot go, with the reason, and records nothing', async () => {
    const runner = scriptedRunner(only)
    await engine.activate(owner, { situation, characters: ['alice'] }, runner.run, signal)
    await expect(engine.resolve(owner, [{ ...outcome('alice', 'succeeded'), moveTo: { location: 'vault' } }], runner.run, signal))
      .rejects.toThrow(/alice: cannot go to vault: the way from The Bar to Vault is locked at The Bar -> Vault: needs a key/)
    expect(store.queue).toEqual([])
    expect(store.commits).toEqual([])
    await expect(engine.resolve(owner, [{ ...outcome('alice', 'failed'), moveTo: { location: 'cellar' } }], runner.run, signal)).rejects.toThrow(/its intent failed, so it does not go anywhere/)
  })

  it('applies a move with the round, tells the game master and keeps where each was and who moved for the keeper', async () => {
    const { resolution } = await act([{ ...outcome('alice', 'succeeded', 'Alice goes down to the cellar'), moveTo: { location: 'cellar', position: 'by the barrels' } }])
    expect(store.commits[0]).toEqual([{ character: alice.character.id, patch: { activity: 'Alice goes down to the cellar' }, move: { to: cellar.id, position: 'by the barrels' } }])
    expect(resolution.done?.moves).toEqual([{ character: 'alice', name: 'Alice', to: 'Cellar', via: 0 }])
    expect(store.queue[0]).toMatchObject({ place: { key: 'the-bar', name: 'The Bar' } })
    expect(store.queue[0]?.entries[0]).toMatchObject({ character: 'alice', at: { key: 'the-bar', name: 'The Bar' }, moved: { key: 'cellar', name: 'Cellar', position: 'by the barrels' } })
  })

  it('does not count staying where it is as a move', async () => {
    const { resolution } = await act([{ ...outcome('alice', 'succeeded'), moveTo: { location: 'bar', position: 'by the window' } }])
    expect(resolution.done?.moves).toEqual([])
    expect(store.queue[0]?.entries[0]?.moved).toBeUndefined()
    expect(store.commits[0]?.[0]?.move).toEqual({ to: bar.id })
  })

  it('does not ask for a move when none is given, and keeps stories without places as they were', async () => {
    store = fakeStore([arthur, alice])
    engine = new TurnEngine(() => boundaries, chat => (chat === 'session-1' ? store : undefined))
    const { resolution } = await act([outcome('alice', 'succeeded')])
    expect(seen).toEqual([])
    expect(resolution.done?.moves).toEqual([])
    expect(store.queue[0]?.place).toBeUndefined()
    expect(store.queue[0]?.entries[0]?.at).toBeUndefined()
  })
})

describe('making up what the story needs', () => {
  const only = { alice: { intent: 'a', commitment: 'low' as const } }
  let created: { need: string; what: string; turn: number }[]
  let consolidated: number
  let release: (() => void) | undefined

  const settingsWith = (authoring: Partial<typeof DEFAULT_SETTINGS.authoring>) => () => ({ ...QUIET, authoring: { ...QUIET.authoring, ...authoring } })

  beforeEach(() => {
    created = []
    consolidated = 0
    release = undefined
    boundaries.author = {
      create: (job) => { created.push({ need: job.need, what: job.what, turn: job.turn }); return Promise.resolve({ created: [{ kind: 'place', key: 'attic', name: 'Attic' }] }) },
      consolidate: () => { consolidated += 1; return new Promise((done) => { release = () => { done({ resolved: 1, notes: '' }) } }) },
    }
  })

  const wait = async (): Promise<void> => { await new Promise(resolve => setTimeout(resolve, 5)) }
  const round = async () => {
    const runner = scriptedRunner(only)
    await engine.activate(owner, { situation, characters: ['alice'] }, runner.run, signal)
    await engine.resolve(owner, [outcome('alice', 'succeeded')], runner.run, signal)
  }

  it('hands the request to the world author with the reason and what is needed, and gives back what it made', async () => {
    const report = await engine.expand(owner, { need: 'scene_change', what: '  The story goes up to the attic.  ' }, signal)
    expect(created).toEqual([{ need: 'scene_change', what: 'The story goes up to the attic.', turn: 1 }])
    expect(report.created).toEqual([{ kind: 'place', key: 'attic', name: 'Attic' }])
  })

  it('refuses a reason that is not one, an empty request, and a request in the middle of a round', async () => {
    await expect(engine.expand(owner, { need: 'colour', what: 'a parrot' }, signal)).rejects.toThrow(/not a reason.*scene_change, arrival, introduction/)
    await expect(engine.expand(owner, { need: 'arrival', what: '  ' }, signal)).rejects.toThrow(/say what is needed/)
    const runner = scriptedRunner(only)
    await engine.activate(owner, { situation, characters: ['alice'] }, runner.run, signal)
    await expect(engine.expand(owner, { need: 'arrival', what: 'Mira' }, signal)).rejects.toThrow(/resolve the round first/)
    expect(created).toEqual([])
  })

  it('refuses when the world is closed, and when the turn already made as many things as the chat allows', async () => {
    store.settings = settingsWith({ enabled: false })
    await expect(engine.expand(owner, { need: 'arrival', what: 'Mira' }, signal)).rejects.toThrow(/this world is closed/)
    store.settings = settingsWith({ perTurn: 2 })
    store.story.consolidation.enqueue({ kind: 'location', subjectId: 1, note: 'x', turn: 1 })
    await engine.expand(owner, { need: 'arrival', what: 'Mira' }, signal)
    store.story.consolidation.enqueue({ kind: 'character', subjectId: 1, note: 'x', turn: 1 })
    await expect(engine.expand(owner, { need: 'arrival', what: 'Tom' }, signal)).rejects.toThrow(/2 new things were already made up this turn, which is the most this chat allows/)
    await expect(engine.expand({ chat: 'session-1', turn: 2 }, { need: 'arrival', what: 'Tom' }, signal)).resolves.toBeDefined()
  })

  it('fits what was made up into the world in the background once enough waits, and the turn does not wait for it', async () => {
    store.settings = settingsWith({ consolidateAfter: 2 })
    store.story.consolidation.enqueue({ kind: 'location', subjectId: 1, note: 'x', turn: 1 })
    await round()
    await engine.narrate(owner, narration())
    await wait()
    expect(consolidated).toBe(0)
    store.story.consolidation.enqueue({ kind: 'character', subjectId: 1, note: 'x', turn: 1 })
    const next = { chat: 'session-1', turn: 2 }
    const runner = scriptedRunner(only)
    await engine.activate(next, { situation, characters: ['alice'] }, runner.run, signal)
    await engine.resolve(next, [outcome('alice', 'succeeded')], runner.run, signal)
    await engine.narrate(next, narration())
    expect(store.completed).toBe(2)
    expect(consolidated).toBe(1)
    expect(engine.waitingToFit(next)).toBe(2)
    release?.()
  })

  it('runs one at a time per chat, and again for what is left once it is done', async () => {
    store.settings = settingsWith({ consolidateAfter: 1 })
    store.story.consolidation.enqueue({ kind: 'location', subjectId: 1, note: 'x', turn: 1 })
    await round()
    await engine.narrate(owner, narration())
    const next = { chat: 'session-1', turn: 2 }
    const runner = scriptedRunner(only)
    await engine.activate(next, { situation, characters: ['alice'] }, runner.run, signal)
    await engine.resolve(next, [outcome('alice', 'succeeded')], runner.run, signal)
    await engine.narrate(next, narration())
    expect(consolidated).toBe(1)
    release?.()
    await wait()
    const third = { chat: 'session-1', turn: 3 }
    await engine.activate(third, { situation, characters: ['alice'] }, runner.run, signal)
    await engine.resolve(third, [outcome('alice', 'succeeded')], runner.run, signal)
    await engine.narrate(third, narration())
    expect(consolidated).toBe(2)
    release?.()
  })

  it('also does it for something that has waited several turns, however few are waiting', async () => {
    store.settings = settingsWith({ consolidateAfter: 10 })
    store.story.consolidation.enqueue({ kind: 'character', subjectId: 1, note: 'x', turn: 1 })
    const late = { chat: 'session-1', turn: 5 }
    const runner = scriptedRunner(only)
    await engine.activate(late, { situation, characters: ['alice'] }, runner.run, signal)
    await engine.resolve(late, [outcome('alice', 'succeeded')], runner.run, signal)
    await engine.narrate(late, narration())
    expect(consolidated).toBe(1)
    release?.()
  })

  it('does nothing when the world is closed or nothing waits, and tells the log when it fails, leaving the items queued', async () => {
    const problems: string[] = []
    engine = new TurnEngine(() => boundaries, chat => (chat === 'session-1' ? store : undefined), (message) => { problems.push(message) })
    store.settings = settingsWith({ enabled: false, consolidateAfter: 1 })
    store.story.consolidation.enqueue({ kind: 'character', subjectId: 1, note: 'x', turn: 1 })
    await round()
    await engine.narrate(owner, narration())
    expect(consolidated).toBe(0)
    store.settings = settingsWith({ consolidateAfter: 1 })
    boundaries.author = { ...boundaries.author, consolidate: () => Promise.reject(new Error('the model is down')) }
    const next = { chat: 'session-1', turn: 2 }
    const runner = scriptedRunner(only)
    await engine.activate(next, { situation, characters: ['alice'] }, runner.run, signal)
    await engine.resolve(next, [outcome('alice', 'succeeded')], runner.run, signal)
    await engine.narrate(next, narration())
    await wait()
    expect(problems).toEqual(['made-up characters and places were not fitted into the world: the model is down'])
    expect(store.story.consolidation.pending()).toHaveLength(1)
  })
})

describe('what the game master decides characters do with things', () => {
  const only = { alice: { intent: 'a', commitment: 'low' as const }, bob: { intent: 'b', commitment: 'low' as const } }
  const take = { item: 'lantern', action: 'take' as const }

  const act = async (outcomes: Outcome[]) => {
    const runner = scriptedRunner(only)
    await engine.activate(owner, { situation, characters: ['alice', 'bob'] }, runner.run, signal)
    return { runner, resolve: () => engine.resolve(owner, outcomes, runner.run, signal) }
  }

  it('checks them together, in order, and tells the game master every reason before the round is recorded', async () => {
    const seen: unknown[] = []
    store.checkItemChanges = (entries) => { seen.push(entries); return { ok: false, problems: ['bob: cannot take lantern: Brass lantern is held by Alice, who has to give it'] } }
    const { resolve } = await act([{ ...outcome('alice', 'succeeded'), itemChanges: [take] }, { ...outcome('bob', 'succeeded'), itemChanges: [take] }])
    await expect(resolve()).rejects.toThrow(/bob: cannot take lantern: Brass lantern is held by Alice, who has to give it/)
    expect(seen).toEqual([[{ character: 'alice', changes: [take] }, { character: 'bob', changes: [take] }]])
    expect(store.queue).toEqual([])
    expect(store.commits).toEqual([])
  })

  it('does not ask when nobody handles anything, and refuses things done by a character whose intent failed', async () => {
    let asked = 0
    store.checkItemChanges = (entries) => { asked += 1; return { ok: true, effects: entries.map(() => []) } }
    const first = await act([outcome('alice', 'succeeded'), outcome('bob', 'succeeded')])
    await first.resolve()
    expect(asked).toBe(0)
    engine.forget('session-1')
    const second = await act([{ ...outcome('alice', 'failed'), itemChanges: [take] }, outcome('bob', 'succeeded')])
    await expect(second.resolve()).rejects.toThrow(/alice: its intent failed, so it does nothing with things/)
  })

  it('applies them with the round, in the order of the outcomes, and keeps what came of each for the keeper and tells the game master', async () => {
    const applied: unknown[] = []
    store.commit = (updates) => {
      applied.push(updates.map(update => update.items))
      return updates.map(update => (update.items === undefined ? [] : [{ item: { key: 'lantern', name: 'Brass lantern' }, action: 'take' as const, summary: 'now carried by Alice' }]))
    }
    const { resolve } = await act([{ ...outcome('alice', 'succeeded'), itemChanges: [take] }, outcome('bob', 'succeeded')])
    const resolution = await resolve()
    expect(applied).toEqual([[[take], undefined]])
    expect(resolution.done?.things).toEqual([{ character: 'alice', name: 'Brass lantern', action: 'take', summary: 'now carried by Alice' }])
    expect(store.queue[0]?.entries.find(entry => entry.character === 'alice')?.items).toEqual([{ name: 'Brass lantern', action: 'take', summary: 'now carried by Alice' }])
    expect(store.queue[0]?.entries.find(entry => entry.character === 'bob')?.items).toBeUndefined()
  })

  it('tells each character what it has on it', async () => {
    store.carried = id => (id === alice.character.id ? [{ key: 'coat', name: 'Wool coat', quantity: 1, quality: '', notable: false, hidden: false, where: 'worn on the torso' }] : [])
    const { runner } = await act([outcome('alice', 'succeeded'), outcome('bob', 'succeeded')])
    expect(runner.requests.find(request => request.member.key === 'alice')?.carrying?.map(entry => entry.name)).toEqual(['Wool coat'])
    expect(runner.requests.find(request => request.member.key === 'bob')?.carrying).toBeUndefined()
  })
})

describe('time in the turn', () => {
  const only = { alice: { intent: 'a', commitment: 'low' as const } }
  const evening = Date.UTC(1912, 9, 4, 21, 40)

  async function resolveRound(elapsed?: number, mode: 'simulated' | 'real' = 'simulated') {
    store.session.clock.start(mode, mode === 'real' ? store.wall : evening)
    const runner = scriptedRunner(only)
    await engine.activate(owner, { situation, characters: ['alice'] }, runner.run, signal)
    return engine.resolve(owner, [outcome('alice', 'succeeded')], runner.run, signal, elapsed)
  }

  it('takes the default time for a round when the game master says nothing', async () => {
    const plain = await resolveRound()
    expect(plain.done?.time).toEqual({ from: evening, to: evening + 30_000, zone: 'UTC' })
  })

  it('takes the time the game master says, and keeps it with the round for the keeper', async () => {
    const resolved = await resolveRound(600)
    expect(resolved.done?.time).toEqual({ from: evening, to: evening + 600_000, zone: 'UTC' })
    expect(store.queue[0]?.time).toEqual({ from: evening, to: evening + 600_000, zone: 'UTC' })
  })

  it('does not take a time that is not a whole number of seconds up to a day, and tells how to pass more', async () => {
    store.session.clock.start('simulated', evening)
    const runner = scriptedRunner(only)
    await engine.activate(owner, { situation, characters: ['alice'] }, runner.run, signal)
    for (const bad of [-1, 1.5, 86_401]) await expect(engine.resolve(owner, [outcome('alice', 'succeeded')], runner.run, signal, bad)).rejects.toThrow(/whole number of seconds from 0 to 86400.*advance_time/)
    expect(store.queue).toEqual([])
    expect(store.session.clock.get()?.now).toBe(evening)
  })

  it('refuses a time for a round when time follows the wall clock, and takes as long as the round did', async () => {
    store.session.clock.start('real', store.wall)
    store.settings = () => ({ ...QUIET, clock: { ...QUIET.clock, mode: 'real' } })
    const runner = scriptedRunner(only)
    await engine.activate(owner, { situation, characters: ['alice'] }, runner.run, signal)
    await expect(engine.resolve(owner, [outcome('alice', 'succeeded')], runner.run, signal, 60)).rejects.toThrow(/follows the wall clock: leave elapsed_seconds out/)
    store.wall += 90_000
    const done = await engine.resolve(owner, [outcome('alice', 'succeeded')], runner.run, signal)
    expect(done.done?.time).toMatchObject({ to: store.wall })
  })

  it('does not pass the time of a retry twice: the round takes the time once', async () => {
    store.session.clock.start('simulated', evening)
    const runner = scriptedRunner({ alice: [{ intent: 'a', commitment: 'high' }, { intent: 'a again', commitment: 'high' }] })
    await engine.activate(owner, { situation, characters: ['alice'] }, runner.run, signal)
    const first = await engine.resolve(owner, [outcome('alice', 'failed')], runner.run, signal, 120)
    expect(first.next?.attempt).toBe(2)
    expect(store.session.clock.get()?.now).toBe(evening)
    const second = await engine.resolve(owner, [outcome('alice', 'succeeded')], runner.run, signal)
    expect(second.done?.time).toEqual({ from: evening, to: evening + 120_000, zone: 'UTC' })
  })

  it('tells each character what time it is', async () => {
    store.session.clock.start('simulated', evening)
    const runner = scriptedRunner(only)
    await engine.activate(owner, { situation, characters: ['alice'] }, runner.run, signal)
    expect(runner.requests[0]?.time).toEqual({ mode: 'simulated', now: evening, zone: 'UTC' })
  })

  describe('skipping ahead', () => {
    it('works before the first round and between rounds, and puts the skip at the round it follows', async () => {
      store.session.clock.start('simulated', evening)
      expect(engine.advanceTime(owner, { byMinutes: 30, reason: 'they wait' })).toMatchObject({ from: evening, to: evening + 30 * 60_000 })
      const runner = scriptedRunner(only)
      await engine.activate(owner, { situation, characters: ['alice'] }, runner.run, signal)
      await engine.resolve(owner, [outcome('alice', 'succeeded')], runner.run, signal)
      expect(engine.advanceTime(owner, { untilTime: '07:00', reason: 'they sleep' }).to).toBe(Date.UTC(1912, 9, 5, 7))
      expect(store.session.clock.log({ kind: 'skip' }).map(step => [step.round, step.reason])).toEqual([[0, 'they wait'], [1, 'they sleep']])
    })

    it('is not possible in the middle of a round, after the turn, or when time follows the wall clock', async () => {
      store.session.clock.start('simulated', evening)
      const runner = scriptedRunner(only)
      await engine.activate(owner, { situation, characters: ['alice'] }, runner.run, signal)
      expect(() => engine.advanceTime(owner, { byMinutes: 5, reason: 'x' })).toThrow(/resolve the round first/)
      await engine.resolve(owner, [outcome('alice', 'succeeded')], runner.run, signal)
      await engine.narrate(owner, narration())
      expect(() => engine.advanceTime(owner, { byMinutes: 5, reason: 'x' })).toThrow(/already recorded/)
      store.session.clock.resync('real', store.wall, 2)
      store.settings = () => ({ ...QUIET, clock: { ...QUIET.clock, mode: 'real' } })
      expect(() => engine.advanceTime({ chat: owner.chat, turn: 2 }, { byMinutes: 5, reason: 'x' })).toThrow(/follows the wall clock/)
    })

    it('says why a request cannot be done', () => {
      store.session.clock.start('simulated', evening)
      expect(() => engine.advanceTime(owner, { untilTime: 'soon', reason: 'x' })).toThrow(/not a time of day/)
      expect(() => engine.advanceTime(owner, { byMinutes: 100_000, reason: 'x' })).toThrow(/more than the 30 days/)
    })
  })
})

describe('the player\'s character in a round', () => {
  const street = location(2, 'Street')
  const bar = location(1, 'The Bar')
  const evening = Date.UTC(1912, 9, 4, 21, 40)
  const goes = (travelSeconds?: number) => {
    store.checkMove = (character, request) => (character === 'arthur'
      ? { ok: true, move: { to: street.id }, plan: { from: bar.id, to: street.id, via: [street.id], ...(travelSeconds === undefined ? {} : { travelSeconds }) }, to: { key: request.location, name: street.name } }
      : { ok: false, problems: ['no'] })
    store.session.clock.start('simulated', evening)
  }
  const walk = (extra: Partial<Outcome> = {}): Outcome => ({ ...outcome('arthur', 'succeeded', 'Arthur walks out to the street'), moveTo: { location: 'street' }, ...extra })
  const state = [placed(arthur, bar), placed(alice, bar), bob, carol, dan]

  beforeEach(() => { store = fakeStore(state); engine = new TurnEngine(() => boundaries, chat => (chat === 'session-1' ? store : undefined)) })

  it('is resolved with the outcomes of the characters that acted, without having been asked to act: it moves, and the round is recorded with it', async () => {
    goes()
    const runner = scriptedRunner({ alice: { intent: 'a', commitment: 'low' } })
    await engine.activate(owner, { situation, characters: ['alice'] }, runner.run, signal)
    const done = await engine.resolve(owner, [outcome('alice', 'succeeded'), walk()], runner.run, signal)
    expect(done.done?.moves).toEqual([{ character: 'arthur', name: 'Arthur', to: 'Street', via: 0 }])
    expect(store.commits[0]?.map(update => update.character)).toEqual([alice.character.id, arthur.character.id])
    expect(store.commits[0]?.[1]?.move).toEqual({ to: street.id })
    expect(store.queue[0]?.entries.map(entry => [entry.character, entry.player === true])).toEqual([['alice', false], ['arthur', true]])
    expect(store.queue[0]?.entries[1]).toMatchObject({ intent: 'Arthur walks out to the street', result: 'succeeded', moved: { key: 'street', name: 'Street' } })
  })

  it('is not required of the game master, and is taken once, at the first resolve of a round', async () => {
    goes()
    const runner = scriptedRunner({ alice: [{ intent: 'a', commitment: 'high' }, { intent: 'again', commitment: 'high' }] })
    await engine.activate(owner, { situation, characters: ['alice'] }, runner.run, signal)
    await expect(engine.resolve(owner, [outcome('alice', 'succeeded'), walk(), walk()], runner.run, signal)).rejects.toThrow(/more than one outcome for arthur/)
    const first = await engine.resolve(owner, [outcome('alice', 'failed'), walk()], runner.run, signal)
    expect(first.next?.attempt).toBe(2)
    await expect(engine.resolve(owner, [outcome('alice', 'succeeded'), walk()], runner.run, signal)).rejects.toThrow(/arthur is not waiting for an outcome/)
    const done = await engine.resolve(owner, [outcome('alice', 'succeeded')], runner.run, signal)
    expect(done.done?.moves.map(move => move.character)).toEqual(['arthur'])
  })

  it('is a round of its own when nobody else needs to react, with the time that journey takes', async () => {
    goes(300)
    const done = await engine.resolve(owner, [walk()], scriptedRunner({}).run, signal)
    expect(done.done).toMatchObject({ round: 1, updated: ['arthur'], time: { from: evening, to: evening + 300_000 }, spoken: [] })
    expect(store.queue[0]).toMatchObject({ round: 1, situation: 'Arthur: Arthur walks out to the street' })
    expect(engine.missing(owner)).toMatch(/call narrate/)
    await engine.narrate(owner, narration('Arthur steps out.'))
    expect(store.completed).toBe(1)
  })

  it('takes at least as long as the journey, whatever the game master says, and as long as it says when that is longer', async () => {
    goes(300)
    expect((await engine.resolve(owner, [walk()], scriptedRunner({}).run, signal, 60)).done?.time.to).toBe(evening + 300_000)
    expect((await engine.resolve(owner, [walk()], scriptedRunner({}).run, signal, 900)).done?.time.to).toBe(evening + 300_000 + 900_000)
  })

  it('takes the default time when the journey is not timed, and is refused when it cannot be made', async () => {
    goes()
    expect((await engine.resolve(owner, [walk()], scriptedRunner({}).run, signal)).done?.time.to).toBe(evening + 30_000)
    store.checkMove = () => ({ ok: false, problems: ['the way is locked'] })
    await expect(engine.resolve(owner, [walk()], scriptedRunner({}).run, signal)).rejects.toThrow(/arthur: cannot go to street: the way is locked/)
    await expect(engine.resolve(owner, [walk({ result: 'failed' })], scriptedRunner({}).run, signal)).rejects.toThrow(/its intent failed, so it does not go anywhere/)
  })

  it('counts as a round of the turn, which the chat limits', async () => {
    goes()
    store.maxRounds = 1
    await engine.resolve(owner, [walk()], scriptedRunner({}).run, signal)
    await expect(engine.resolve(owner, [walk()], scriptedRunner({}).run, signal)).rejects.toThrow(/most this chat allows/)
  })

  it('does not stand in for the characters: another character alone is not a round of its own', async () => {
    goes()
    await expect(engine.resolve(owner, [outcome('alice', 'succeeded')], scriptedRunner({}).run, signal)).rejects.toThrow(/call activate_characters first/)
  })
})

describe('characters away from the player', () => {
  const street = location(2, 'Street')
  const item = (extra: Partial<{ key: string; characters: string[]; place: string }> = {}) => ({ key: 'e1', kind: 'engagement' as const, at: 1000, characters: ['bob', 'carol'], place: 'street', text: 'You were to meet at the Street. Decide.', ...extra })
  let handled: string[]
  let written: RoundRecord[]

  beforeEach(() => {
    handled = []
    written = []
    boundaries.committer = { commit: (job) => { written.push(...job.rounds); return Promise.resolve({ writes: 0, notes: '' }) } }
    store.markHandled = (keys) => { handled.push(...keys) }
    store.checkMove = (_character, request) => ({ ok: true, move: { to: street.id }, plan: { from: 1, to: street.id, via: [street.id] }, to: { key: request.location, name: street.name } })
  })

  async function deliver(answers: Parameters<typeof scriptedRunner>[0], run = true) {
    const runner = scriptedRunner({ alice: { intent: 'a', commitment: 'low' }, ...answers })
    await engine.activate(owner, { situation, characters: ['alice'] }, runner.run, signal)
    await engine.resolve(owner, [outcome('alice', 'succeeded')], runner.run, signal)
    await engine.narrate(owner, narration(), run ? runner.run : undefined)
    return runner
  }
  const offstage = () => written.find(record => record.offstage === true)

  it('are asked after the turn what they do about what fell due, told it as the situation, and what they decide is applied and recorded for the keeper', async () => {
    store.dueOffScene = () => [item()]
    const runner = await deliver({ bob: { intent: 'Bob goes to the street to wait', commitment: 'high' }, carol: { intent: 'Carol stays in', commitment: 'low' } })
    await vi.waitFor(() => { expect(handled).toEqual(['e1']) })
    const asked = runner.requests.filter(request => request.situation.startsWith('You were to meet at the Street. Decide.'))
    expect(asked.map(request => request.member.key)).toEqual(['bob', 'carol'])
    expect(asked.map(request => request.situation)).toEqual(['You were to meet at the Street. Decide.', 'You were to meet at the Street. Decide.\nBob has decided: Bob goes to the street to wait.'])
    const last = store.commits.at(-1)!
    expect(last.map(update => [update.character, update.patch, update.move])).toEqual([
      [bob.character.id, { activity: 'Bob goes to the street to wait' }, { to: street.id }],
      [carol.character.id, { activity: 'Carol stays in' }, undefined],
    ])
    expect(offstage()).toMatchObject({ turn: 1, round: 101, situation: 'You were to meet at the Street. Decide.', offstage: true })
    expect(offstage()?.entries.map(entry => [entry.character, entry.intent, entry.commitment, entry.spoken, entry.moved?.key])).toEqual([['bob', 'Bob goes to the street to wait', 'high', false, 'street'], ['carol', 'Carol stays in', 'low', false, undefined]])
  })

  it('are not asked when the chat turns it off, when the turn gave no way to ask, or when nothing is due', async () => {
    store.dueOffScene = () => [item()]
    store.settings = () => ({ ...QUIET, offstage: { ...QUIET.offstage, perTurn: 0 } })
    const off = await deliver({ bob: { intent: 'x', commitment: 'high' } })
    expect(off.requests.map(request => request.member.key)).toEqual(['alice'])
    engine.forget(owner.chat)
    store.settings = () => ({ ...QUIET })
    const unasked = await deliver({ bob: { intent: 'x', commitment: 'high' } }, false)
    expect(unasked.requests.map(request => request.member.key)).toEqual(['alice'])
    engine.forget(owner.chat)
    store.dueOffScene = () => []
    const none = await deliver({ bob: { intent: 'x', commitment: 'high' } })
    expect(none.requests.map(request => request.member.key)).toEqual(['alice'])
    expect(handled).toEqual([])
  })

  it('are no more than the chat allows, oldest first, and what did not fit is left for the next turn', async () => {
    store.dueOffScene = () => [item({ key: 'e1', characters: ['bob', 'carol'] }), item({ key: 'e2', characters: ['dan'] })]
    store.settings = () => ({ ...QUIET, offstage: { ...QUIET.offstage, perTurn: 2 } })
    await deliver({ bob: { intent: 'b', commitment: 'low' }, carol: { intent: 'c', commitment: 'low' }, dan: { intent: 'd', commitment: 'low' } })
    await vi.waitFor(() => { expect(handled).toEqual(['e1']) })
    expect(written.filter(record => record.offstage === true)).toHaveLength(1)
  })

  it('are asked to say in a line what came of it, in the same request, and the lines are the note for the player', async () => {
    store.dueOffScene = () => [item()]
    const runner = await deliver({ bob: { intent: 'Bob goes to the street', commitment: 'high', account: 'Bob waited at the street.' }, carol: { intent: 'Carol stays in', commitment: 'low' } })
    await vi.waitFor(() => { expect(handled).toEqual(['e1']) })
    expect(runner.requests.filter(request => request.member.key !== 'alice').every(request => request.away === true)).toBe(true)
    expect(runner.requests.filter(request => request.member.key === 'alice').every(request => request.away === undefined)).toBe(true)
    expect(store.notes().find(note => note.kind === 'away')).toEqual({ kind: 'away', turn: 1, lines: ['Bob waited at the street.'] })
  })

  it('are not asked for the line, and leave no note, when the chat does not want the summary', async () => {
    store.dueOffScene = () => [item()]
    store.settings = () => ({ ...QUIET, offstage: { ...QUIET.offstage, summary: false } })
    const runner = await deliver({ bob: { intent: 'b', commitment: 'low', account: 'x' }, carol: { intent: 'c', commitment: 'low' } })
    await vi.waitFor(() => { expect(handled).toEqual(['e1']) })
    expect(runner.requests.some(request => request.away === true)).toBe(false)
    expect(store.notes().some(note => note.kind === 'away')).toBe(false)
  })

  it('act no more than the chat allows each, so that several things due do not make one character act again and again', async () => {
    store.dueOffScene = () => [item({ key: 'e1', characters: ['bob'] }), item({ key: 'e2', characters: ['bob'] }), item({ key: 'e3', characters: ['carol'] })]
    store.settings = () => ({ ...QUIET, offstage: { ...QUIET.offstage, perTurn: 5, perCharacter: 1 } })
    await deliver({ bob: { intent: 'b', commitment: 'low' }, carol: { intent: 'c', commitment: 'low' } })
    await vi.waitFor(() => { expect(handled).toEqual(['e1', 'e3']) })
    expect(written.filter(record => record.offstage === true)).toHaveLength(2)
  })

  it('stay as they were when nobody could answer: it is asked again another time', async () => {
    store.dueOffScene = () => [item({ characters: ['bob'] })]
    await deliver({ bob: new Error('the model is down') })
    await new Promise(resolve => setTimeout(resolve, 30))
    expect(handled).toEqual([])
    expect(offstage()).toBeUndefined()
  })

  it('do not go anywhere when they will not try hard, or when there is no place, or when it cannot be reached', async () => {
    store.dueOffScene = () => [item({ characters: ['bob', 'carol', 'dan'] })]
    store.settings = () => ({ ...QUIET, offstage: { ...QUIET.offstage, perTurn: 3 } })
    store.checkMove = (who) => (who === 'dan' ? { ok: false, problems: ['no way'] } : { ok: true, move: { to: street.id }, plan: { from: 1, to: street.id, via: [street.id] }, to: { key: 'street', name: 'Street' } })
    await deliver({ bob: { intent: 'b', commitment: 'low' }, carol: { intent: 'c', commitment: 'medium' }, dan: { intent: 'd', commitment: 'high' } })
    await vi.waitFor(() => { expect(handled).toEqual(['e1']) })
    expect(store.commits.at(-1)?.map(update => [update.character, update.move !== undefined])).toEqual([[bob.character.id, false], [carol.character.id, true], [dan.character.id, false]])
  })
})

describe('what the game master changes of what is tracked', () => {
  const only = { alice: { intent: 'a', commitment: 'low' as const } }
  const hurt = { variable: 'health', subject: 'alice', by: -3 }
  const effect = { subjectName: 'Alice', variable: { key: 'health', name: 'Health', bands: [{ upTo: 3, label: 'hurt' }, { upTo: 10, label: 'well' }] }, from: 10, to: 7 }

  async function resolveWith(outcomes: Outcome[]) {
    const runner = scriptedRunner(only)
    await engine.activate(owner, { situation, characters: ['alice'] }, runner.run, signal)
    return await engine.resolve(owner, outcomes, runner.run, signal)
  }

  it('is checked with the outcomes, and every reason is told to the game master before the round is recorded', async () => {
    store.checkVariableChanges = changes => changes.map(change => `${change.variable}: there is no such thing`)
    await expect(resolveWith([{ ...outcome('alice', 'succeeded'), variableChanges: [hurt] }])).rejects.toThrow(/alice: health: there is no such thing/)
    expect(store.queue).toEqual([])
    expect(store.commits).toEqual([])
  })

  it('is applied with the round, even when the intent failed, and said in words to the game master and kept for the keeper', async () => {
    const applied: unknown[] = []
    store.changeVariables = (turn, changes) => { applied.push([turn, changes]); return changes.map(() => effect as never) }
    const resolved = await resolveWith([{ ...outcome('alice', 'failed'), variableChanges: [hurt] }])
    expect(applied).toEqual([[1, [hurt]]])
    expect(resolved.done?.variables).toEqual(['Alice\'s Health is now well (7) (it was well (10))'])
    expect(store.queue[0]?.entries[0]?.variables).toEqual([{ subject: 'Alice', name: 'Health', from: 'well (10)', to: 'well (7)' }])
  })

  it('is not asked of the store when nobody changes anything', async () => {
    let asked = 0
    store.checkVariableChanges = (changes) => { asked += changes.length; return [] }
    await resolveWith([outcome('alice', 'succeeded')])
    expect(asked).toBe(0)
  })

  it('tells each character what it can tell of itself and of those here', async () => {
    store.trackedFor = (id) => (id === alice.character.id ? { self: 'Health: hurt (2)', others: [] } : { self: '', others: [] })
    const runner = scriptedRunner(only)
    await engine.activate(owner, { situation, characters: ['alice'] }, runner.run, signal)
    expect(runner.requests[0]?.tracked).toEqual({ self: 'Health: hurt (2)', others: [] })
  })
})

describe('what the player could do next', () => {
  const only = { alice: { intent: 'a', commitment: 'low' as const } }
  const three = ['Ask Alice about the key', 'Take the lantern', 'Slip out through the cellar']
  const problems: string[] = []

  beforeEach(() => {
    problems.length = 0
    engine = new TurnEngine(() => boundaries, () => store, message => problems.push(message))
    store.settings = () => ({ ...DEFAULT_SETTINGS, preview: { enabled: false }, suggestions: { count: 3 } })
  })

  async function deliver() {
    const runner = scriptedRunner(only)
    await engine.activate(owner, { situation, characters: ['alice'] }, runner.run, signal)
    await engine.resolve(owner, [outcome('alice', 'succeeded')], runner.run, signal)
    return await engine.narrate(owner, narration())
  }
  const settled = () => new Promise(resolve => setTimeout(resolve, 5))

  it('do not hold the output back: narrate is accepted at once and the lines are made afterwards, from what the player read', async () => {
    let release!: (lines: string[]) => void
    const jobs: Parameters<Boundaries['suggester']['suggest']>[0][] = []
    boundaries.suggester = { suggest: (job) => { jobs.push(job); return new Promise((done) => { release = done }) } }
    const output = await deliver()
    expect(store.completed).toBe(1)
    expect(output).toEqual({ segments: [{ type: 'narration', text: 'Time passes.' }], repaired: false })
    expect(jobs).toHaveLength(1)
    expect(jobs[0]).toMatchObject({ chat: 'session-1', turn: 1, count: 3, output })
    expect(store.notes()).toEqual([])
    release(three)
    await settled()
    expect(store.notes()).toEqual([{ kind: 'suggestions', turn: 1, lines: three }])
  })

  it('are tidied: spaces collapse and lines are trimmed', async () => {
    boundaries.suggester = { suggest: () => Promise.resolve([`  ${three[0]}  `, three[1]!.replace(' ', '   '), `${three[2]}\n`]) }
    await deliver()
    await settled()
    expect(store.notes()[0]?.lines).toEqual(['Ask Alice about the key', 'Take the lantern', three[2]])
  })

  it('are not made when the chat offers none, and nobody is asked', async () => {
    store.settings = () => ({ ...DEFAULT_SETTINGS, preview: { enabled: false }, suggestions: { count: 0 } })
    const suggest = vi.fn(() => Promise.resolve(three))
    boundaries.suggester = { suggest }
    await deliver()
    await settled()
    expect(suggest).not.toHaveBeenCalled()
    expect(store.notes()).toEqual([])
  })

  it('are reported, quietly, when they are not acceptable or the suggester fails, and the player simply has none', async () => {
    boundaries.suggester = { suggest: () => Promise.resolve(['Same', 'same', 'Other']) }
    await deliver()
    await settled()
    expect(problems).toEqual([expect.stringMatching(/suggestions for turn 1 were not made: .*must differ/)])
    expect(store.notes()).toEqual([])
    engine.forget(owner.chat)
    problems.length = 0
    boundaries.suggester = { suggest: () => Promise.reject(new Error('the model is down')) }
    await deliver()
    await settled()
    expect(problems).toEqual(['suggestions for turn 1 were not made: the model is down'])
  })

  it('made too late for their turn are dropped: the next turn has started', async () => {
    let release!: (lines: string[]) => void
    boundaries.suggester = { suggest: () => new Promise((done) => { release = done }) }
    await deliver()
    engine.skip({ chat: 'session-1', turn: 2 })
    release(three)
    await settled()
    expect(store.notes()).toEqual([])
  })

  it('give nothing when the suggester has nothing to offer', async () => {
    await deliver()
    await settled()
    expect(store.notes()).toEqual([])
    expect(problems).toEqual([])
  })
})

describe('the preview of the scene', () => {
  const only = { alice: { intent: 'a', commitment: 'low' as const } }

  beforeEach(() => { store.settings = () => ({ ...DEFAULT_SETTINGS, suggestions: { count: 0 }, preview: { enabled: true } }) })

  it('is accepted first in a turn, trimmed, once, and says what comes next in the turn', () => {
    expect(engine.preview(owner, '  Air goes still.\r\n\nHow will she answer?  ')).toBe('Air goes still.\n\nHow will she answer?')
    expect(() => engine.preview(owner, 'Again')).toThrow(/already shown/)
    expect(engine.missing(owner)).toMatch(/^call activate_characters/)
  })

  it('is a new one in the next turn', () => {
    engine.preview(owner, 'One')
    expect(engine.preview({ chat: 'session-1', turn: 2 }, 'Two')).toBe('Two')
  })

  it('is refused when it is empty or longer than an opening, with the reason', () => {
    expect(() => engine.preview(owner, '  \n ')).toThrow(/write the preview/)
    expect(() => engine.preview(owner, 'x'.repeat(701))).toThrow(/keep the preview to 700 characters/)
    expect(engine.preview(owner, 'x'.repeat(700))).toHaveLength(700)
  })

  it('is refused once the characters were asked, because it comes first', async () => {
    store.settings = () => ({ ...DEFAULT_SETTINGS, suggestions: { count: 0 }, preview: { enabled: false } })
    const runner = scriptedRunner(only)
    await engine.activate(owner, { situation, characters: ['alice'] }, runner.run, signal)
    store.settings = () => ({ ...DEFAULT_SETTINGS, suggestions: { count: 0 }, preview: { enabled: true } })
    expect(() => engine.preview(owner, 'Late')).toThrow(/comes first/)
  })

  it('is refused when the chat turned it off', () => {
    store.settings = () => ({ ...DEFAULT_SETTINGS, preview: { enabled: false } })
    expect(() => engine.preview(owner, 'Air goes still.')).toThrow(/shows no preview/)
  })

  it('comes before the characters are asked: they are refused until it is shown, and what is missing says so', async () => {
    const runner = scriptedRunner(only)
    await expect(engine.activate(owner, { situation, characters: ['alice'] }, runner.run, signal)).rejects.toThrow(/call preview_scene first/)
    await expect(engine.resolve(owner, [outcome('alice', 'succeeded')], runner.run, signal)).rejects.toThrow(/call preview_scene first/)
    expect(engine.missing(owner)).toMatch(/^call preview_scene first/)
    expect(runner.requests).toEqual([])
    engine.preview(owner, 'Air goes still.')
    expect(engine.missing(owner)).toMatch(/^call activate_characters/)
    await engine.activate(owner, { situation, characters: ['alice'] }, runner.run, signal)
    expect(runner.requests).toHaveLength(1)
  })

  it('is not asked for when the chat turned it off, or when the turn needs no round', async () => {
    store.settings = () => ({ ...DEFAULT_SETTINGS, suggestions: { count: 0 }, preview: { enabled: false } })
    const runner = scriptedRunner(only)
    await engine.activate(owner, { situation, characters: ['alice'] }, runner.run, signal)
    engine.forget(owner.chat)
    store.settings = () => ({ ...DEFAULT_SETTINGS, suggestions: { count: 0 }, preview: { enabled: true } })
    engine.skip({ chat: 'session-1', turn: 2 })
    expect(String(engine.missing({ chat: 'session-1', turn: 2 }))).not.toMatch(/preview_scene/)
  })

  it('does not change what the output must carry or when the turn may end', async () => {
    engine.preview(owner, 'Air goes still.')
    const runner = scriptedRunner(only)
    await engine.activate(owner, { situation, characters: ['alice'] }, runner.run, signal)
    await engine.resolve(owner, [outcome('alice', 'succeeded')], runner.run, signal)
    expect(engine.missing(owner)).toMatch(/^call narrate/)
    expect((await engine.narrate(owner, narration())).repaired).toBe(false)
  })
})

describe('the world acting by itself', () => {
  const only = { alice: { intent: 'a', commitment: 'low' as const } }
  const evening = Date.UTC(1912, 9, 4, 21, 40)
  const problems: string[] = []
  const beat = (text = 'Thunder rolls over the ridge.') => ({ type: 'beat' as const, text })
  const make = (key: string, extra: Partial<Parameters<FakeStore['session']['triggers']['add']>[0]> = {}): void => {
    store.session.triggers.add({ key, name: `Trigger ${key}`, condition: { type: 'time', from: '1912-10-04T21:00' }, effects: [beat()], repeat: false, priority: 0, ...extra }, 'world', 0)
  }

  beforeEach(() => {
    problems.length = 0
    engine = new TurnEngine(() => boundaries, chat => (chat === 'session-1' ? store : undefined), message => problems.push(message))
    store.settings = () => ({ ...QUIET, clock: { ...QUIET.clock, timeZone: 'UTC' } })
    store.session.clock.start('simulated', evening)
    const cuesFor = store.cuesFor
    store.cuesFor = id => cuesFor(id === alice.character.id ? store.session.characters.getBySourceId('alice')!.id : id)
    const upcomingFor = store.upcomingFor
    store.upcomingFor = (id, turn) => upcomingFor(id === alice.character.id ? store.session.characters.getBySourceId('alice')!.id : id, turn)
    store.session.characters.add({ sourceId: 'alice', name: 'Alice', aliases: [], kind: 'person', tier: 'principal', role: 'npc', control: 'agent', summary: '', personality: '', background: '', appearance: '', speech: { style: '', examples: [] } })
  })

  async function round(runner = scriptedRunner(only)) {
    await engine.activate(owner, { situation, characters: ['alice'] }, runner.run, signal)
    return { runner, report: await engine.resolve(owner, [outcome('alice', 'succeeded')], runner.run, signal) }
  }

  it('is told to the game master with the round it came after, with the beats it is to weave in', async () => {
    make('storm', { effects: [beat(), { type: 'cue', audience: { characters: ['alice'] }, text: 'The shutters rattle.' }] })
    const { report } = await round()
    expect(report.done?.world).toEqual([{ name: 'Trigger storm', events: [], cues: [{ names: ['Alice'], text: 'The shutters rattle.' }], beats: [{ id: 1, text: 'Thunder rolls over the ridge.' }] }])
  })

  it('does not fire again: it fires when the condition turns true, and the round after is quiet', async () => {
    make('storm')
    expect((await round()).report.done?.world).toHaveLength(1)
    const runner = scriptedRunner({ alice: [only.alice, { ...only.alice }] })
    await engine.activate(owner, { situation: moment(1394), characters: ['alice'] }, runner.run, signal)
    expect((await engine.resolve(owner, [outcome('alice', 'succeeded')], runner.run, signal)).done?.world).toEqual([])
  })

  it('tells a character what it is made to notice the next time it acts, once, and the same on the retry', async () => {
    make('scream', { condition: { type: 'time', from: '1912-10-04T21:00' }, effects: [{ type: 'cue', audience: { characters: ['alice'] }, text: 'You hear a scream upstairs.' }] })
    const first = await round()
    expect(first.runner.requests[0]?.cues).toBeUndefined()
    const runner = scriptedRunner({ alice: [{ intent: 'a', commitment: 'high' }, { intent: 'again', commitment: 'high' }, { intent: 'c', commitment: 'low' }] })
    await engine.activate(owner, { situation: moment(1403), characters: ['alice'] }, runner.run, signal)
    expect(runner.requests[0]?.cues).toEqual(['You hear a scream upstairs.'])
    const retry = await engine.resolve(owner, [outcome('alice', 'failed')], runner.run, signal)
    expect(retry.next?.attempt).toBe(2)
    expect(runner.requests[1]?.cues).toEqual(['You hear a scream upstairs.'])
    await engine.resolve(owner, [outcome('alice', 'succeeded')], runner.run, signal)
    await engine.activate(owner, { situation: `${situation} (after)`, characters: ['alice'] }, runner.run, signal)
    expect(runner.requests[2]?.cues).toBeUndefined()
    expect(store.session.triggers.notes({ status: 'pending' })).toEqual([])
  })

  it('takes the beats the game master says it wove in, refuses ones that are not to be woven in, and lets the others stay', async () => {
    make('one')
    make('two', { effects: [beat('A bell tolls.')] })
    await round()
    expect(store.pendingBeats().map(entry => entry.id)).toEqual([1, 2])
    await expect(engine.narrate(owner, narration(), undefined, [1, 9])).rejects.toThrow(/addressed: 9 is not a beat still to weave in/)
    expect(store.completed).toBe(0)
    await engine.narrate(owner, narration(), undefined, [2])
    expect(store.pendingBeats().map(entry => entry.id)).toEqual([1])
    expect(store.completed).toBe(1)
  })

  it('is told to the game master after a skip in time, with what the time that passed brought', async () => {
    make('dawn', { condition: { type: 'time', from: '1912-10-05T07:00' }, effects: [beat('The sun is up.')] })
    expect(engine.advanceTime(owner, { untilTime: '06:00', reason: 'they sleep' }).world).toEqual([])
    const skipped = engine.advanceTime(owner, { untilTime: '07:30', reason: 'they sleep on' })
    expect(skipped.world).toEqual([{ name: 'Trigger dawn', events: [], cues: [], beats: [{ id: 1, text: 'The sun is up.' }] }])
  })

  it('is looked at before a turn begins, for what came true while the player was away', () => {
    make('late', { condition: { type: 'time', from: '1912-10-04T20:00' } })
    expect(engine.fireAtStart(owner).map(entry => entry.name)).toEqual(['Trigger late'])
    expect(engine.fireAtStart(owner)).toEqual([])
  })

  it('that cannot be applied is given up and reported, and the round goes on', async () => {
    make('broken', { effects: [{ type: 'edit', edit: { moves: [{ character: 'alice', to: 'nowhere' }] } }] })
    const { report } = await round()
    expect(report.done?.world).toEqual([])
    expect(store.problems).toEqual([expect.stringMatching(/the trigger "broken" could not fire and is given up: .*nowhere/)])
    expect(store.session.triggers.getByKey('broken')?.status).toBe('failed')
  })

  it('does nothing when the chat turned it off', async () => {
    store.settings = () => ({ ...QUIET, clock: { ...QUIET.clock, timeZone: 'UTC' }, triggers: { ...QUIET.triggers, enabled: false } })
    make('storm')
    expect((await round()).report.done?.world).toEqual([])
    expect(store.session.triggers.getByKey('storm')?.fireCount).toBe(0)
  })

  describe('what is known beforehand', () => {
    const exam = { type: 'time' as const, from: '1912-10-08T09:00' }

    it('is told to a character who is among those who know, with when it is to happen, and not to the others; a secret is told to nobody', async () => {
      make('exam', { condition: exam, announce: { audience: { characters: ['alice'] }, text: 'The final exam is at nine.' } })
      make('plot', { condition: { type: 'time', from: '1912-10-20T00:00' } })
      const runner = scriptedRunner(only)
      await engine.activate(owner, { situation, characters: ['alice'] }, runner.run, signal)
      expect(runner.requests[0]?.upcoming).toEqual([{ text: 'The final exam is at nine.', when: 'Tuesday 8 October 1912, 09:00, in 3 days 11 hours' }])
      expect(store.upcoming(1)).toEqual([{ text: 'The final exam is at nine.', who: 'Alice', when: 'Tuesday 8 October 1912, 09:00, in 3 days 11 hours' }])
      store.session.characters.add({ sourceId: 'bob', name: 'Bob', aliases: [], kind: 'person', tier: 'principal', role: 'npc', control: 'agent', summary: '', personality: '', background: '', appearance: '', speech: { style: '', examples: [] } })
      expect(store.upcomingFor(store.session.characters.getBySourceId('bob')!.id, 1)).toEqual([])
    })

    it('is gone once it fired', () => {
      make('exam', { condition: { type: 'time', from: '1912-10-04T22:00' }, announce: { audience: 'everyone', text: 'The ball begins at ten.' } })
      expect(store.upcoming(1)).toHaveLength(1)
      store.runTriggers(2, 0)
      expect(store.upcoming(1)).toHaveLength(1)
      store.session.clock.advance({ to: Date.UTC(1912, 9, 4, 22, 30), turn: 2, round: 0, kind: 'skip', reason: 'later' })
      store.runTriggers(3, 0)
      expect(store.upcoming(3)).toEqual([])
    })
  })
})

describe('judging what the player tries', () => {
  beforeEach(() => { store.settings = () => ({ ...DEFAULT_SETTINGS, suggestions: { count: 0 }, preview: { enabled: true } }) })

  it('is asked first in an ordinary turn: nothing else is accepted before it, and an engine that was not asked does not need it', async () => {
    const { run } = scriptedRunner(calm)
    engine.expectJudgement(owner)
    await expect(engine.activate(owner, { situation }, run, signal)).rejects.toThrow(/call judge_action first/)
    expect(() => engine.preview(owner, 'Air goes still.')).toThrow(/judge the action first/)
    await expect(engine.resolve(owner, [outcome('arthur', 'failed')], run, signal)).rejects.toThrow(/call judge_action first/)
    expect(engine.missing(owner)).toMatch(/call judge_action first/)
    engine.judge(owner, true, 'Arthur opens the door, which is possible.')
    engine.preview(owner, 'Air goes still.')
    await expect(engine.activate(owner, { situation }, run, signal)).resolves.toMatchObject({ attempt: 1 })
  })

  it('refuses a reason that is empty and a second judgement, and does not judge an out-of-character command', () => {
    engine.expectJudgement(owner)
    expect(() => engine.judge(owner, true, '  ')).toThrow(/give the reason/)
    engine.judge(owner, false, 'No magic.')
    expect(() => engine.judge(owner, true, 'Again')).toThrow(/already judged/)
    const other: TurnOwner = { chat: 'session-1', turn: 2 }
    engine.beginOoc(other, 'spawn a key')
    expect(() => engine.judge(other, true, 'x')).toThrow(/out-of-character/)
  })

  it('has what cannot work played as a failed attempt of the player\'s character alone: nobody is asked, no preview is needed, and it cannot succeed', async () => {
    const { run, requests } = scriptedRunner(calm)
    engine.expectJudgement(owner)
    engine.judge(owner, false, 'There is no magic.')
    await expect(engine.activate(owner, { situation }, run, signal)).rejects.toThrow(/the action cannot work \(There is no magic\.\)/)
    await expect(engine.narrate(owner, narration('Nothing happens.'))).rejects.toThrow(/the attempt does not work \(There is no magic\.\): call resolve_round with one outcome, for the player's character only.*then narrate/)
    await expect(engine.resolve(owner, [outcome('arthur', 'succeeded')], run, signal)).rejects.toThrow(/must be failed/)
    const resolved = await engine.resolve(owner, [outcome('arthur', 'failed', 'Arthur waves a hand; nothing comes of it')], run, signal)
    expect(resolved.done?.updated).toEqual(['arthur'])
    expect(requests).toEqual([])
    await expect(engine.narrate(owner, narration('Nothing happens.'))).resolves.toMatchObject({ repaired: false })
  })
})

describe('judging where the action happens', () => {
  const tavern = location(1, 'Tavern')
  const cellar = location(2, 'Cellar', { parentId: 1 })
  const market = location(3, 'Market')

  beforeEach(() => {
    for (const place of [tavern, cellar, market]) store.session.locations.add({ sourceId: place.sourceId!, name: place.name, description: '', features: [], ...(place.parentId === undefined ? {} : { parentId: place.parentId }) })
  })

  const standing = (where: typeof tavern | undefined) => { store.cast = () => [where === undefined ? arthur : placed(arthur, where), alice, bob] }

  it('does not work when the character is somewhere else: it has to go there first, whatever was judged', async () => {
    standing(tavern)
    expect(engine.judge(owner, true, 'Arthur talks to the baker.', 'market')).toEqual({ allowed: false, reason: 'Arthur is at Tavern, not at Market where this happens: Arthur has to go there first', elsewhere: true })
    await expect(engine.activate(owner, { situation }, scriptedRunner(calm).run, signal)).rejects.toThrow(/Arthur has to go there first/)
  })

  it('stands as judged when the place is the character\'s own, or holds it or is inside it, or none is said', () => {
    standing(cellar)
    for (const [turn, at] of [[1, 'cellar'], [2, 'tavern'], [3, undefined], [4, '  ']] as const) {
      expect(engine.judge({ chat: 'session-1', turn }, true, 'Arthur searches.', at)).toEqual({ allowed: true, reason: 'Arthur searches.' })
    }
    standing(tavern)
    expect(engine.judge({ chat: 'session-1', turn: 5 }, true, 'Arthur searches.', 'cellar')).toEqual({ allowed: true, reason: 'Arthur searches.' })
  })

  it('takes a character that is in no place as no evidence, and asks for a place that exists', () => {
    standing(undefined)
    expect(engine.judge(owner, true, 'Arthur talks to the baker.', 'market')).toEqual({ allowed: true, reason: 'Arthur talks to the baker.' })
    expect(() => engine.judge({ chat: 'session-1', turn: 2 }, true, 'x', 'moon')).toThrow(/there is no place "moon"/)
  })
})

describe('an out-of-character command', () => {
  const player = { ...outcome('arthur', 'succeeded') }

  it('is ruled on first; nothing changes before the ruling, nobody is asked and no preview is shown', async () => {
    const { run } = scriptedRunner(calm)
    engine.beginOoc(owner, 'Alice goes home')
    await expect(engine.activate(owner, { situation }, run, signal)).rejects.toThrow(/asks nobody to act/)
    expect(() => engine.preview(owner, 'x')).toThrow(/shows no preview/)
    await expect(engine.resolve(owner, [outcome('alice', 'succeeded')], run, signal)).rejects.toThrow(/rule on it first with ooc_ruling/)
    expect(() => engine.advanceTime(owner, { byMinutes: 5, reason: 'x' })).toThrow(/rule on it first/)
    await expect(engine.expand(owner, { need: 'object', what: 'a key' }, signal)).rejects.toThrow(/rule on it first/)
    await expect(engine.narrate(owner, [])).rejects.toThrow(/rule on it first/)
    expect(engine.missing(owner)).toMatch(/rule on it first/)
  })

  it('refused: nothing may change and the output has no segments, only the note', async () => {
    const { run } = scriptedRunner(calm)
    engine.beginOoc(owner, 'Alice vanishes in smoke')
    expect(engine.rule(owner, false, ' There is no magic. ')).toEqual({ legal: false, note: 'There is no magic.' })
    await expect(engine.resolve(owner, [outcome('alice', 'succeeded')], run, signal)).rejects.toThrow(/was refused/)
    await expect(engine.narrate(owner, narration('Smoke!'))).rejects.toThrow(/refused/)
    await expect(engine.narrate(owner, [])).resolves.toEqual({ segments: [], repaired: false, ooc: { legal: false, note: 'There is no magic.' } })
    expect(store.commits).toEqual([])
    expect(store.completed).toBe(1)
  })

  it('legal: decrees outcomes for any characters, asked or not, forced and recorded, then narration only', async () => {
    const { run, requests } = scriptedRunner(calm)
    engine.beginOoc(owner, 'Alice goes home and Arthur sighs')
    engine.rule(owner, true, 'Alice goes home.')
    expect(() => engine.rule(owner, true, 'Again')).toThrow(/already ruled/)
    await expect(engine.resolve(owner, [], run, signal)).rejects.toThrow(/at least one outcome/)
    await expect(engine.resolve(owner, [outcome('nobody', 'succeeded')], run, signal)).rejects.toThrow(/nobody is not a character/)
    await expect(engine.resolve(owner, [outcome('alice', 'succeeded'), outcome('alice', 'succeeded')], run, signal)).rejects.toThrow(/more than one outcome for alice/)
    const done = await engine.resolve(owner, [outcome('alice', 'succeeded', 'Alice goes home'), player], run, signal)
    expect(done.done?.updated.sort()).toEqual(['alice', 'arthur'])
    expect(requests).toEqual([])
    const [record] = store.queue
    expect(record!.situation).toContain('out-of-character command (Alice goes home and Arthur sighs)')
    expect(record!.entries.find(entry => entry.character === 'alice')).toMatchObject({ forced: true, intent: 'Alice goes home', commitment: 'high' })
    expect(record!.entries.find(entry => entry.character === 'arthur')?.forced).toBeUndefined()
    await expect(engine.narrate(owner, [{ type: 'utterance', character: 'alice', text: 'Bye' }])).rejects.toThrow(/nobody was asked to speak/)
    await expect(engine.narrate(owner, narration('Alice leaves.'))).resolves.toMatchObject({ segments: [{ type: 'narration', text: 'Alice leaves.' }], ooc: { legal: true, note: 'Alice goes home.' } })
  })

  it('refuses a ruling with no reason, and a ruling on a turn that is not a command', () => {
    expect(() => engine.rule(owner, true, 'x')).toThrow(/not an out-of-character command/)
    engine.beginOoc(owner, 'x')
    expect(() => engine.rule(owner, true, '  ')).toThrow(/give the reason/)
    expect(() => engine.rule(owner, true, 'y'.repeat(401))).toThrow(/longer than 400/)
  })
})

describe('an out-of-character question', () => {
  const answering = (text: string) => { const asked: Parameters<RunAnswer>[0][] = []; return { asked, run: ((request) => { asked.push(request); return Promise.resolve(text) }) as RunAnswer } }

  it('is answered first; nothing can change, nobody is asked, and no ruling is given on it', async () => {
    const { run, requests } = scriptedRunner(calm)
    engine.beginOoc(owner, 'Who is the man at the bar?', true)
    await expect(engine.activate(owner, { situation }, run, signal)).rejects.toThrow(/question asks nobody to act and changes nothing/)
    await expect(engine.resolve(owner, [outcome('alice', 'succeeded')], run, signal)).rejects.toThrow(/answer it first with ooc_answer/)
    expect(() => engine.advanceTime(owner, { byMinutes: 5, reason: 'x' })).toThrow(/answer it first/)
    await expect(engine.expand(owner, { need: 'object', what: 'a key' }, signal)).rejects.toThrow(/answer it first/)
    expect(() => engine.preview(owner, 'x')).toThrow(/ooc_answer/)
    expect(() => engine.rule(owner, true, 'fine')).toThrow(/answer it with ooc_answer/)
    await expect(engine.narrate(owner, [])).rejects.toThrow(/answer it first/)
    expect(engine.missing(owner)).toMatch(/answer it first with ooc_answer/)
    expect(requests).toEqual([])
  })

  it('is answered from what the player\'s character is given, with the question as the moment, and delivered as the answer alone', async () => {
    const { run } = scriptedRunner(calm)
    const { asked, run: answer } = answering(' Arthur has not met him. ')
    engine.beginOoc(owner, 'Who is the man at the bar?', true)
    await expect(engine.answer(owner, answer, signal)).resolves.toEqual({ legal: true, note: 'Arthur has not met him.', question: true })
    expect(asked).toHaveLength(1)
    expect(asked[0]).toMatchObject({ member: { key: 'arthur' }, situation: 'Who is the man at the bar?', attempt: 1, lookup: false })
    await expect(engine.answer(owner, answer, signal)).rejects.toThrow(/already answered/)
    await expect(engine.resolve(owner, [outcome('alice', 'succeeded')], run, signal)).rejects.toThrow(/changes nothing/)
    await expect(engine.narrate(owner, narration('A stranger.'))).rejects.toThrow(/deliver no segments/)
    await expect(engine.narrate(owner, [])).resolves.toEqual({ segments: [], repaired: false, ooc: { legal: true, note: 'Arthur has not met him.', question: true } })
    expect(store.commits).toEqual([])
    expect(store.completed).toBe(1)
  })

  it('is not answered when it is not a question, with nothing, and an answer that is too long is cut', async () => {
    await expect(engine.answer(owner, answering('x').run, signal)).rejects.toThrow(/not an out-of-character question/)
    engine.beginOoc(owner, 'Who is he?')
    await expect(engine.answer(owner, answering('x').run, signal)).rejects.toThrow(/not an out-of-character question/)
    engine.beginOoc(owner, 'Who is he?', true)
    await expect(engine.answer(owner, answering('  ').run, signal)).rejects.toThrow(/answer is empty/)
    const long = await engine.answer(owner, answering('y'.repeat(2000)).run, signal)
    expect(long.note).toHaveLength(1200)
    expect(long.note.endsWith('…')).toBe(true)
  })
})

describe('who acts when the world has places', () => {
  const bar = location(1, 'The Bar')
  it('leaves out, and refuses when named, a character that is in no place', () => {
    const cast = [placed(arthur, bar), placed(alice, bar), bob]
    expect(everyoneActs.plan({ cast })).toEqual(['alice'])
    expect(() => everyoneActs.plan({ cast, requested: ['alice', 'bob'] })).toThrow(/cannot activate bob: in no place/)
    expect(everyoneActs.plan({ cast: [arthur, alice, bob] })).toEqual(['alice', 'bob'])
  })
})

describe('a crowd', () => {
  const bar = location(1, 'The Bar')
  const street = location(2, 'Street')
  const crowd = Array.from({ length: 9 }, (_, index) => ({ ...alice, key: `npc${index}`, character: { ...alice.character, id: 100 + index, name: `Npc ${index}` }, place: { location: index < 3 ? bar : street, position: '' } }))
  const script = Object.fromEntries(crowd.map(member => [member.key, { intent: 'x', commitment: 'low' as const }]))

  it('asks only those with the player when the game master names nobody and everyone would be too many', async () => {
    store = fakeStore([placed(arthur, bar), ...crowd as never[]])
    const engine = new TurnEngine(() => boundaries, chat => (chat === 'session-1' ? store : undefined))
    const out = await engine.activate(owner, { situation }, scriptedRunner(script).run, signal)
    expect(out.reports.map(report => report.character).sort()).toEqual(['npc0', 'npc1', 'npc2'])
  })

  it('refuses when more than the limit are named', async () => {
    store = fakeStore([placed(arthur, bar), ...crowd as never[]])
    const engine = new TurnEngine(() => boundaries, chat => (chat === 'session-1' ? store : undefined))
    await expect(engine.activate(owner, { situation, characters: crowd.slice(0, 5).map(member => member.key) }, scriptedRunner(script).run, signal)).rejects.toThrow(/more than one round allows \(4\)/)
  })
})

describe('a character saying the same thing again', () => {
  it('is not asked to say it twice in one turn', async () => {
    const same = scriptedRunner({ alice: { intent: 'a', utterance: 'Hello.', commitment: 'low' } })
    await engine.activate(owner, { situation, characters: ['alice'] }, same.run, signal)
    await engine.resolve(owner, [outcome('alice', 'succeeded')], same.run, signal)
    await engine.activate(owner, { situation: moment(1606), characters: ['alice'] }, same.run, signal)
    await engine.resolve(owner, [outcome('alice', 'succeeded')], same.run, signal)
    expect(engine.spoken(owner).map(utterance => utterance.text)).toEqual(['Hello.'])
  })
})

describe('delivering what was said', () => {
  it('carries the words as the character said them, without the quotes the game master added', async () => {
    const runner = scriptedRunner({ alice: { intent: 'a', utterance: 'Hello.', commitment: 'low' } })
    await engine.activate(owner, { situation, characters: ['alice'] }, runner.run, signal)
    await engine.resolve(owner, [outcome('alice', 'succeeded')], runner.run, signal)
    const out = await engine.narrate(owner, [{ type: 'utterance', character: 'alice', text: '"Hello."' }], runner.run)
    expect(out.segments).toEqual([{ type: 'utterance', character: 'alice', name: 'Alice', text: 'Hello.' }])
  })
})
