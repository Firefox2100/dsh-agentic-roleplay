import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { MAX_SAMPLES, type SiteReport } from '../../../src/shared/decisions.ts'
import { DECISIONS_FILE, readDecisionStats, recordDecisions } from '../../../src/host/decisions/stats.ts'

let folder: string
beforeEach(() => { folder = mkdtempSync(join(tmpdir(), 'decisions-')) })
afterEach(() => { rmSync(folder, { recursive: true, force: true }) })

const at = (): Date => new Date('2026-10-24T12:00:00.000Z')
const report = (over: Partial<SiteReport> = {}): SiteReport => ({ mode: 'shadow', items: 2, decided: 0, escalated: 0, fallbacks: 0, agreed: 1, disagreed: 1, decisionMs: 20, llmMs: 400, samples: [], ...over })

describe('what is kept about a story\'s decisions', () => {
  it('starts empty, and adds each run of a site to what is there', () => {
    expect(readDecisionStats(folder, at).sites.triggers).toMatchObject({ runs: 0, items: 0 })
    recordDecisions(folder, 'triggers', report(), at)
    recordDecisions(folder, 'triggers', report({ items: 3, agreed: 3, disagreed: 0 }), at)
    recordDecisions(folder, 'reflection', report({ items: 1, agreed: 1, disagreed: 0 }), at)
    const stats = readDecisionStats(folder, at)
    expect(stats.since).toBe('2026-10-24T12:00:00.000Z')
    expect(stats.sites.triggers).toMatchObject({ runs: 2, items: 5, agreed: 4, disagreed: 1, decisionMs: 40, llmMs: 800 })
    expect(stats.sites.reflection).toMatchObject({ runs: 1, items: 1 })
  })

  it('keeps only the newest disagreements, and the latest problem only until a run goes well', () => {
    const sample = (turn: number) => ({ turn, what: 'x', probability: 0.5, decision: true, llm: false })
    recordDecisions(folder, 'triggers', report({ samples: Array.from({ length: MAX_SAMPLES }, (_, index) => sample(index)), problem: 'down' }), at)
    expect(readDecisionStats(folder, at).sites.triggers.problem).toBe('down')
    recordDecisions(folder, 'triggers', report({ samples: [sample(99)] }), at)
    const kept = readDecisionStats(folder, at).sites.triggers
    expect(kept.samples).toHaveLength(MAX_SAMPLES)
    expect(kept.samples.at(-1)?.turn).toBe(99)
    expect(kept).not.toHaveProperty('problem')
  })

  it('starts again from a file that cannot be read instead of stopping the story, and ignores a site it does not know', () => {
    writeFileSync(join(folder, DECISIONS_FILE), '{ not json')
    expect(readDecisionStats(folder, at).sites.triggers.runs).toBe(0)
    recordDecisions(folder, 'triggers', report(), at)
    expect(readDecisionStats(folder, at).sites.triggers.runs).toBe(1)
    writeFileSync(join(folder, DECISIONS_FILE), JSON.stringify({ since: 'then', sites: { triggers: { runs: 'many' }, elsewhere: { runs: 1 } } }))
    const stats = readDecisionStats(folder, at)
    expect(stats.since).toBe('then')
    expect(stats.sites.triggers.runs).toBe(0)
    expect(Object.keys(stats.sites).sort()).toEqual(['agency', 'reflection', 'refusal', 'rules', 'secrets', 'triggers'])
  })
})
