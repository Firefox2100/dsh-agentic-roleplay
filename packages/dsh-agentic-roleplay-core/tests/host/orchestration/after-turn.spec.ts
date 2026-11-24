import { createSessionStore, type SessionStore } from '@dsh-agentic-roleplay/state'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { AfterTurnJobs } from '../../../src/host/orchestration/after-turn.ts'
import { DEFAULT_SETTINGS } from '../../../src/shared/settings.ts'
import type { Boundaries, PlanJob, ReflectionJob, TurnStore } from '../../../src/host/orchestration/boundaries.ts'
import { ReflectionRefusedError } from '../../../src/host/sessions/errors.ts'
import { reflectionStatus } from '../../../src/host/memory/reflection.ts'

let session: SessionStore
let finish: (() => void) | undefined
let failWith: Error | undefined
let problems: string[]
let written: string[]
let jobs: Promise<unknown>[]
let afterTurn: AfterTurnJobs
const asked: ReflectionJob[] = []

beforeEach(() => {
  session = createSessionStore(':memory:', { id: 's', name: 'S', world: { id: 'w', name: 'W' } })
  problems = []
  written = []
  jobs = []
  asked.length = 0
  failWith = undefined
  const store = { story: session } as unknown as TurnStore
  const reflector = {
    reflect: (job: ReflectionJob) => new Promise<{ characters: { name: string; added: number; revised: number; dropped: number }[] }>((resolve, reject) => {
      asked.push(job)
      finish = () => { if (failWith === undefined) resolve({ characters: [{ name: 'Clara', added: 1, revised: 0, dropped: 0 }] }); else reject(failWith) }
    }),
  }
  afterTurn = new AfterTurnJobs({
    boundaries: () => ({ reflector }) as unknown as Boundaries,
    stores: () => store,
    track: (_chat, job) => { jobs.push(job) },
    problem: (message) => { problems.push(message) },
    written: (chat) => { written.push(chat) },
  })
})
afterEach(() => { session.close() })

describe('a reflection the player asked for', () => {
  it('runs in the background, one at a time per chat, and tells that what was written is to be indexed', async () => {
    afterTurn.reflectNow({ chat: 'c', turn: 7 }, new AbortController().signal)
    expect(afterTurn.isReflecting('c')).toBe(true)
    expect(asked).toMatchObject([{ chat: 'c', turn: 7, reason: 'manual' }])
    expect(() => { afterTurn.reflectNow({ chat: 'c', turn: 7 }, new AbortController().signal) }).toThrow(ReflectionRefusedError)
    finish!()
    await Promise.all(jobs)
    expect(afterTurn.isReflecting('c')).toBe(false)
    expect(written).toEqual(['c'])
    afterTurn.reflectNow({ chat: 'c', turn: 8 }, new AbortController().signal)
    expect(asked).toHaveLength(2)
    finish!()
    await Promise.all(jobs)
  })

  it('keeps why it failed for the settings tab, clears it with the next success, and says nothing when it was cancelled', async () => {
    failWith = new Error('the model did not answer')
    afterTurn.reflectNow({ chat: 'c', turn: 7 }, new AbortController().signal)
    finish!()
    await Promise.all(jobs)
    expect(problems).toEqual(['what the characters believe was not sorted: the model did not answer'])
    expect(reflectionStatus(session, false).error?.message).toBe('the model did not answer')
    expect(written).toEqual([])

    const cancel = new AbortController()
    afterTurn.reflectNow({ chat: 'c', turn: 8 }, cancel.signal)
    cancel.abort()
    finish!()
    await Promise.all(jobs)
    expect(problems).toHaveLength(1)
  })
})

describe('the story\'s plan', () => {
  const quiet = { ...DEFAULT_SETTINGS, factions: { ...DEFAULT_SETTINGS.factions, perTurn: 0 }, triggers: { ...DEFAULT_SETTINGS.triggers, enabled: false }, reflection: { ...DEFAULT_SETTINGS.reflection, auto: false }, authoring: { ...DEFAULT_SETTINGS.authoring, enabled: false } }
  let kept: PlanJob[]
  let report: { changed: boolean; made: string[]; failed: string[]; cancelled: string[] }
  const run = (plan: Partial<typeof DEFAULT_SETTINGS.plan>, turn: number, boundaryFails = false) => {
    const store = { story: session, settings: () => ({ ...quiet, plan: { ...DEFAULT_SETTINGS.plan, ...plan } }) } as unknown as TurnStore
    const keeper = { keep: (job: PlanJob) => { kept.push(job); return boundaryFails ? Promise.reject(new Error('no answer')) : Promise.resolve(report) } }
    const jobsOf = new AfterTurnJobs({ boundaries: () => ({ planKeeper: keeper }) as unknown as Boundaries, stores: () => store, track: (_chat, job) => { jobs.push(job) }, problem: (message) => { problems.push(message) }, written: (chat) => { written.push(chat) } })
    jobsOf.start({ chat: 'c', turn }, new AbortController().signal)
    return Promise.all(jobs)
  }
  beforeEach(() => { kept = []; report = { changed: true, made: ['dusk'], failed: [], cancelled: [] } })

  it('is not looked at while it is off, nor before the story has begun', async () => {
    await run({ auto: false }, 10)
    await run({ auto: true, minTurns: 3 }, 2)
    expect(kept).toEqual([])
  })

  it('is looked at when the player asks, whatever the setting says, and one look at a time', async () => {
    const keeper = { keep: (job: PlanJob) => { kept.push(job); return new Promise<typeof report>(() => undefined) } }
    const store = { story: session, settings: () => ({ ...quiet, plan: { ...DEFAULT_SETTINGS.plan, auto: false } }) } as unknown as TurnStore
    const jobsOf = new AfterTurnJobs({ boundaries: () => ({ planKeeper: keeper }) as unknown as Boundaries, stores: () => store, track: () => undefined, problem: () => undefined, written: () => undefined })
    jobsOf.planNow({ chat: 'c', turn: 4 }, new AbortController().signal)
    expect(kept).toMatchObject([{ turn: 4, reason: 'the player asked for a look at the plan' }])
    expect(() => { jobsOf.planNow({ chat: 'c', turn: 4 }, new AbortController().signal) }).toThrow('already being looked at')
  })

  it('is looked at in the background once it is due, tells that the story was written, and reports a trigger it could not make', async () => {
    report = { changed: true, made: [], failed: ['dusk: no such place'], cancelled: [] }
    await run({ auto: true, minTurns: 3 }, 3)
    expect(kept).toMatchObject([{ chat: 'c', turn: 3, reason: 'the story has begun and has no plan yet' }])
    expect(written).toEqual(['c'])
    expect(problems).toEqual(['a trigger the plan asked for was not made: dusk: no such place'])
  })

  it('reports a look that failed and leaves the story as it was', async () => {
    await run({ auto: true }, 3, true)
    expect(problems).toEqual(['the story\'s plan was not looked at: no answer'])
    expect(written).toEqual([])
  })
})
