import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { createSession, sessionFolder } from '@dsh-agentic-roleplay/state'
import type { DecisionService } from '@dsh-ai-providers/core'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { decisionsOfSession } from '../../../src/host/decisions/status.ts'
import { recordDecisions } from '../../../src/host/decisions/stats.ts'
import { SessionNotFoundError } from '../../../src/host/sessions/errors.ts'

let root: string
beforeEach(() => { root = mkdtempSync(join(tmpdir(), 'decision-status-')) })
afterEach(() => { rmSync(root, { recursive: true, force: true }) })

describe('the decisions of a session', () => {
  it('say what service is there and what was kept, and refuse an id that names no session', async () => {
    const id = randomUUID()
    const store = createSession(root, { id, name: 'S', world: { id: 'w', name: 'W' } })
    recordDecisions(sessionFolder(root, id), 'triggers', { mode: 'shadow', items: 1, decided: 0, escalated: 0, fallbacks: 0, agreed: 1, disagreed: 0, decisionMs: 3, llmMs: 40, samples: [] })
    store.close()
    const service = { provider: 'typesafe', model: 'jev-latest' } as unknown as DecisionService
    const present = decisionsOfSession({ sessionsDir: () => root, service: () => service }, id)
    expect(present).toMatchObject({ available: true, provider: 'typesafe', model: 'jev-latest', stats: { sites: { triggers: { runs: 1, agreed: 1 } } } })
    const absent = decisionsOfSession({ sessionsDir: () => root, service: () => undefined }, id)
    expect(absent.available).toBe(false)
    expect(absent).not.toHaveProperty('provider')
    expect(() => decisionsOfSession({ sessionsDir: () => root, service: () => undefined }, 'nope')).toThrow(SessionNotFoundError)
  })
})
