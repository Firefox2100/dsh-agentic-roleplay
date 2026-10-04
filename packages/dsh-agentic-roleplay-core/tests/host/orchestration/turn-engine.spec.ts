import { beforeEach, describe, expect, it } from 'vitest'
import type { Boundaries } from '../../../src/host/orchestration/boundaries.ts'
import { defaultBoundaries, everyoneActs } from '../../../src/host/orchestration/defaults.ts'
import type { Outcome } from '../../../src/host/orchestration/protocol.ts'
import { TurnEngine, type RawSegment, type RunCharacter, type TurnOwner } from '../../../src/host/orchestration/turn-engine.ts'
import { alice, arthur, bob, carol, dan, fakeStore, location, placed, scriptedRunner, type FakeStore } from './fixtures.ts'

const signal = new AbortController().signal
const owner: TurnOwner = { chat: 'session-1', turn: 1 }
const situation = 'Arthur opens the vault door.'

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
      { character: 'bob', name: 'Bob', reason: 'model unavailable' },
      { character: 'carol', name: 'Carol', reason: 'that is not an intent' },
    ])
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
    await expect(engine.resolve(owner, [outcome('alice', 'succeeded'), outcome('alice', 'failed'), outcome('arthur', 'failed')], runner.run, signal))
      .rejects.toThrow(/missing an outcome for bob.*arthur is not waiting.*more than one outcome for alice.*expected exactly: alice, bob, carol, dan/)
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
      'Alice:That is not something I expected.', 'Alice stands and walks to the door while Bob stares at you.', 'Carol:"Oh, please."', 'Dan:Mine!', 'The key glints between them.',
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
    await expect(engine.narrate(owner, narration())).rejects.toThrow(/nothing to deliver yet: call activate_characters first/)
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
  const only = (runner: ReturnType<typeof scriptedRunner>) => engine.activate(owner, { situation, characters: ['alice'] }, runner.run, signal)
  const aliceSucceeds = [outcome('alice', 'succeeded', 'Alice greets him', 'smiling')]
  const hello = [{ type: 'utterance' as const, character: 'alice', text: 'Hello.' }]
  let problems: string[]
  let written: string[]

  beforeEach(() => {
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

  it('writes the waiting rounds in the background when asked, and the turn waits for that run', async () => {
    const started: number[] = []
    let release!: () => void
    boundaries.committer = { commit: job => new Promise((done) => { started.push(job.rounds.length); release = () => { done({ writes: 1, notes: '' }) } }) }
    await play()
    expect(engine.record(owner)).toBe(1)
    await Promise.resolve()
    expect(started).toEqual([1])
    expect(store.completed).toBe(0)
    const delivering = engine.narrate(owner, hello)
    await new Promise(resolve => setTimeout(resolve, 5))
    expect(store.completed).toBe(0)
    release()
    await delivering
    expect(store.completed).toBe(1)
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
    await engine.activate(second, { situation, characters: ['alice'] }, runner.run, signal)
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
    const runner = scriptedRunner({ alice: [voices.alice, { ...voices.alice }] })
    await play(runner)
    engine.record(owner)
    await only(runner)
    await engine.resolve(owner, aliceSucceeds, runner.run, signal)
    engine.record(owner)
    await engine.narrate(owner, [...hello, ...hello])
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

  it('tries once more at delivery when the records were asked for, and goes on without them when that fails too', async () => {
    let calls = 0
    boundaries.committer = { commit: () => { calls += 1; return Promise.reject(new Error('down')) } }
    await play()
    engine.record(owner)
    const output = await engine.narrate(owner, hello)
    expect(calls).toBe(2)
    expect(output).toEqual({ segments: [expect.objectContaining({ type: 'utterance' })], repaired: false })
    expect(store.completed).toBe(1)
    expect(store.queue).toHaveLength(1)
  })

  it('is saved by the second try when the first one failed', async () => {
    let calls = 0
    boundaries.committer = { commit: () => { calls += 1; return calls === 1 ? Promise.reject(new Error('flaky')) : Promise.resolve({ writes: 1, notes: '' }) } }
    await play()
    engine.record(owner)
    await engine.narrate(owner, hello)
    expect(store.queue).toEqual([])
  })

  it('runs the keeper at delivery anyway once too many rounds are waiting', async () => {
    let calls = 0
    boundaries.committer = { commit: () => { calls += 1; return Promise.resolve({ writes: 1, notes: '' }) } }
    const base = store.settings
    store.settings = () => ({ ...base(), memory: { ...base().memory, backlogRounds: 2 } })
    const runner = scriptedRunner({ alice: [voices.alice, { ...voices.alice }] })
    await play(runner)
    await engine.activate(owner, { situation, characters: ['alice'] }, runner.run, signal)
    await engine.resolve(owner, aliceSucceeds, runner.run, signal)
    await engine.narrate(owner, [...hello, ...hello])
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
