import { createSessionStore, readTriggerDefinition, type SessionStore } from '@dsh-agentic-roleplay/state'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { AfterTurnJobs } from '../../../src/host/orchestration/after-turn.ts'
import type { Boundaries, CreateJob, TurnStore } from '../../../src/host/orchestration/boundaries.ts'
import { fireTriggers, noteStore } from '../../../src/host/triggers/notes.ts'
import { DEFAULT_SETTINGS } from '../../../src/shared/settings.ts'

let session: SessionStore
let store: TurnStore
let made: CreateJob[]
let jobs: Promise<unknown>[]
let problems: string[]
let afterTurn: AfterTurnJobs

const clock = () => ({ now: 0, zone: 'UTC' })

beforeEach(() => {
  session = createSessionStore(':memory:', { id: 's', name: 'S', world: { id: 'w', name: 'W' } })
  session.variables.define({ key: 'go', name: 'Go', kind: 'flag', subject: 'world' })
  const read = readTriggerDefinition({
    key: 'arrival', name: 'Arrival', when: { type: 'variable', variable: 'go', op: 'eq', value: true },
    effects: [{ type: 'beat', text: 'Someone new turns up, of this kind: [draw].', draw: ['a hitchhiker', 'a camper'], dispatch: 'author', need: 'arrival' }],
  }, 'trigger')
  if ('problems' in read) throw new Error(read.problems.join('; '))
  session.triggers.add(read.definition, 'world', 0)
  store = { story: session, settings: () => DEFAULT_SETTINGS, ...noteStore(session, () => DEFAULT_SETTINGS, clock) } as unknown as TurnStore
  made = []
  jobs = []
  problems = []
  const author = { create: (job: CreateJob) => { made.push(job); return Promise.resolve({ created: [] }) } }
  afterTurn = new AfterTurnJobs({ boundaries: () => ({ author }) as unknown as Boundaries, stores: () => store, track: (_chat, job) => { jobs.push(job) }, problem: (message) => { problems.push(message) }, written: () => undefined })
})
afterEach(() => { session.close() })

const cast = (): void => { (afterTurn as unknown as { cast: (owner: { chat: string; turn: number }, cancel: AbortSignal) => void }).cast({ chat: 'c', turn: 3 }, new AbortController().signal) }

describe('a beat that has the world author make something', () => {
  it('is never told to the game master, and is made once after the turn with the drawn option in its words', async () => {
    session.variables.set('go', 'world', 0, { value: true }, 1)
    const fired = fireTriggers(session, { settings: DEFAULT_SETTINGS, turn: 1, round: 1, now: 0, zone: 'UTC', problem: (message) => { problems.push(message) } })
    expect(fired.fired[0]!.beats).toEqual([])
    expect(store.pendingBeats()).toEqual([])
    cast()
    await Promise.all(jobs)
    expect(made).toHaveLength(1)
    expect(made[0]).toMatchObject({ chat: 'c', turn: 3, need: 'arrival' })
    expect(made[0]!.what).toMatch(/Someone new turns up, of this kind: (a hitchhiker|a camper)\./)
    cast()
    await Promise.all(jobs)
    expect(made).toHaveLength(1)
    expect(problems).toEqual([])
  })

  it('says why when the author cannot make it, and does nothing for a reason it does not know', async () => {
    const failing = { create: () => Promise.reject(new Error('no answer')) }
    afterTurn = new AfterTurnJobs({ boundaries: () => ({ author: failing }) as unknown as Boundaries, stores: () => store, track: (_chat, job) => { jobs.push(job) }, problem: (message) => { problems.push(message) }, written: () => undefined })
    session.variables.set('go', 'world', 0, { value: true }, 1)
    fireTriggers(session, { settings: DEFAULT_SETTINGS, turn: 1, round: 1, now: 0, zone: 'UTC', problem: () => undefined })
    cast()
    await Promise.all(jobs)
    expect(problems).toEqual(['the world author could not make what a trigger asked for: no answer'])
  })
})

describe('a trigger that mixes the two kinds of beat', () => {
  it('is refused: its beats go to one place', () => {
    const read = readTriggerDefinition({
      key: 'mixed', name: 'Mixed', when: { type: 'variable', variable: 'go', op: 'eq', value: true },
      effects: [{ type: 'beat', text: 'Someone turns up.', dispatch: 'author' }, { type: 'beat', text: 'Tell the game master.' }],
    }, 'trigger')
    expect('problems' in read && read.problems.join(' ')).toMatch(/every beat of the trigger does/)
  })
})
