import { createSessionStore, type SessionStore } from '@dsh-agentic-roleplay/state'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { AfterTurnJobs } from '../../../src/host/orchestration/after-turn.ts'
import type { Boundaries, ReflectionJob, TurnStore } from '../../../src/host/orchestration/boundaries.ts'
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
