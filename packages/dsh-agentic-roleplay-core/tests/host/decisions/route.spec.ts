import { describe, expect, it, vi } from 'vitest'
import type { DecisionService } from '@dsh-ai-providers/core'
import type { DecisionMode } from '../../../src/shared/decisions.ts'
import { MAX_SAMPLES } from '../../../src/shared/decisions.ts'
import { announceProblem, askYesNo, mergeReports, modeFor, noAt, routeVerdicts, yesAt, type Route } from '../../../src/host/decisions/route.ts'

const signal = new AbortController().signal

/** Three keys; the decision model is sure of a and c (yes and no), unsure of b. The language model says yes to a and b. */
const route = (mode: DecisionMode, over: Partial<Route<string>> = {}): Route<string> => ({
  mode, yesAt: 0.85, noAt: 0.15, turn: 4, keys: ['a', 'b', 'c'], what: key => `item ${key}`,
  probabilities: vi.fn(async (keys: readonly string[]) => new Map(keys.map(key => [key, { a: 0.95, b: 0.6, c: 0.04 }[key]!]))),
  llm: vi.fn(async (keys: readonly string[]) => new Map(keys.map(key => [key, key !== 'c']))),
  ...over,
})

describe('the confidence of a chat', () => {
  it('sets the probability from which a yes counts and up to which a no counts', () => {
    expect([yesAt(0.7), noAt(0.7)]).toEqual([0.85, expect.closeTo(0.15, 10)])
    expect([yesAt(0), noAt(0)]).toEqual([0.5, 0.5])
    expect([yesAt(1), noAt(1)]).toEqual([1, 0])
  })
})

describe('routing a site\'s judgements', () => {
  it('asks only the language model in llm mode, and never the decision model', async () => {
    const given = route('llm')
    const { verdicts, report } = await routeVerdicts(given, signal)
    expect([...verdicts]).toEqual([['a', true], ['b', true], ['c', false]])
    expect(given.probabilities).not.toHaveBeenCalled()
    expect(report).toMatchObject({ mode: 'llm', items: 3, decided: 0, escalated: 0, fallbacks: 0 })
  })

  it('takes a yes only when the decision model is confident of it, and counts anything else as no, in decision mode', async () => {
    const given = route('decision')
    const { verdicts, report } = await routeVerdicts(given, signal)
    expect([...verdicts]).toEqual([['a', true], ['b', false], ['c', false]])
    expect(given.llm).not.toHaveBeenCalled()
    expect(report).toMatchObject({ decided: 3, escalated: 0, fallbacks: 0 })
  })

  it('hands what the decision model is unsure of to the language model, and only that, in hybrid mode', async () => {
    const given = route('hybrid')
    const { verdicts, report } = await routeVerdicts(given, signal)
    expect([...verdicts]).toEqual([['a', true], ['c', false], ['b', true]])
    expect(given.llm).toHaveBeenCalledWith(['b'])
    expect(report).toMatchObject({ decided: 2, escalated: 1, fallbacks: 0 })
  })

  it('uses the language model\'s answer and records how often the decision model agreed, in shadow mode', async () => {
    const given = route('shadow', { llm: vi.fn(async (keys: readonly string[]) => new Map(keys.map(key => [key, key === 'a']))) })
    const { verdicts, report } = await routeVerdicts(given, signal)
    expect([...verdicts]).toEqual([['a', true], ['b', false], ['c', false]])
    expect(report).toMatchObject({ mode: 'shadow', agreed: 3, disagreed: 0, decided: 0 })
    const other = await routeVerdicts(route('shadow'), signal)
    expect(other.report).toMatchObject({ agreed: 2, disagreed: 1 })
    expect(other.report.samples).toEqual([{ turn: 4, what: 'item b', probability: 0.6, decision: false, llm: true }])
  })

  it('gives every key to the language model when the decision model cannot be used, and says why, and never in llm mode', async () => {
    for (const mode of ['decision', 'hybrid'] as const) {
      const given = route(mode, { probabilities: vi.fn(async () => { throw new Error('no decision service is selected') }) })
      const { verdicts, report } = await routeVerdicts(given, signal)
      expect([...verdicts]).toEqual([['a', true], ['b', true], ['c', false]])
      expect(report).toMatchObject({ fallbacks: 3, decided: 0, problem: 'no decision service is selected' })
    }
    const shadow = await routeVerdicts(route('shadow', { probabilities: vi.fn(async () => { throw new Error('down') }) }), signal)
    expect(shadow.report).toMatchObject({ agreed: 0, disagreed: 0, problem: 'down' })
    expect([...shadow.verdicts]).toEqual([['a', true], ['b', true], ['c', false]])
  })

  it('does not hide a language model that fails, nor a cancelled run', async () => {
    await expect(routeVerdicts(route('llm', { llm: vi.fn(async () => { throw new Error('the model did not answer') }) }), signal)).rejects.toThrow('the model did not answer')
    const controller = new AbortController()
    controller.abort()
    await expect(routeVerdicts(route('decision', { probabilities: vi.fn(async () => { throw new Error('cancelled') }) }), controller.signal)).rejects.toThrow('cancelled')
  })

  it('asks nobody about nothing', async () => {
    const given = route('hybrid', { keys: [] })
    const { verdicts, report } = await routeVerdicts(given, signal)
    expect(verdicts.size).toBe(0)
    expect(report.items).toBe(0)
    expect(given.probabilities).not.toHaveBeenCalled()
    expect(given.llm).not.toHaveBeenCalled()
  })

  it('treats every probability as sure when no confidence is asked, and almost none as sure when all is asked', async () => {
    expect((await routeVerdicts(route('hybrid', { yesAt: 0.5, noAt: 0.5 }), signal)).report).toMatchObject({ decided: 3, escalated: 0 })
    expect((await routeVerdicts(route('hybrid', { yesAt: 1, noAt: 0 }), signal)).report).toMatchObject({ decided: 0, escalated: 3 })
  })
})

describe('asking a decision model yes-or-no questions', () => {
  it('sends one noul per key about one state and reads the probabilities', async () => {
    const decide = vi.fn(async () => ({ answers: { s1: { type: 'noul', probability: 0.9 }, s2: { type: 'noul', probability: 0.1 } }, model: 'm' }))
    const asked = await askYesNo({ decide } as unknown as DecisionService, { events: ['e'] }, [{ key: 's1', instructions: 'one' }, { key: 's2', instructions: 'two' }], signal)
    expect([...asked]).toEqual([['s1', 0.9], ['s2', 0.1]])
    expect(decide).toHaveBeenCalledWith({ events: ['e'] }, { s1: { type: 'noul', instructions: 'one' }, s2: { type: 'noul', instructions: 'two' } }, { priority: 'background', signal })
  })
})

describe('reporting a problem', () => {
  const report = (problem?: string) => ({ ...mergeReports('hybrid', []), ...problem === undefined ? {} : { problem } })

  it('says it once, again when the reason changes, and starts over after a run that went well', () => {
    const seen = new Map<string, string>()
    const say = vi.fn()
    announceProblem(seen, 'c:triggers', report('down'), say)
    announceProblem(seen, 'c:triggers', report('down'), say)
    announceProblem(seen, 'c:triggers', report('slow'), say)
    announceProblem(seen, 'c:triggers', report(), say)
    announceProblem(seen, 'c:triggers', report('slow'), say)
    expect(say.mock.calls.map(([message]) => message as string)).toEqual([
      expect.stringContaining('down'), expect.stringContaining('slow'), expect.stringContaining('slow'),
    ])
    expect(() => { announceProblem(seen, 'c:triggers', report('down'), undefined) }).not.toThrow()
  })
})

describe('merging reports', () => {
  it('adds the counts and times, keeps the newest disagreements up to the limit and the latest problem', () => {
    const one = { ...mergeReports('shadow', []), items: 2, agreed: 1, disagreed: 1, decisionMs: 10, llmMs: 100, samples: Array.from({ length: MAX_SAMPLES }, (_, index) => ({ turn: index, what: 'x', probability: 0.5, decision: true, llm: false })) }
    const two = { ...mergeReports('shadow', []), items: 1, agreed: 1, decisionMs: 5, llmMs: 50, problem: 'late', samples: [{ turn: 99, what: 'y', probability: 0.1, decision: false, llm: true }] }
    const merged = mergeReports('shadow', [one, two])
    expect(merged).toMatchObject({ mode: 'shadow', items: 3, agreed: 2, disagreed: 1, decisionMs: 15, llmMs: 150, problem: 'late' })
    expect(merged.samples).toHaveLength(MAX_SAMPLES)
    expect(merged.samples.at(-1)?.turn).toBe(99)
  })
})

describe('the default mode of a site when no decision model is set up', () => {
  it('is the language model alone for hybrid, and every other mode is kept as it was chosen', () => {
    expect([modeFor('hybrid', undefined), modeFor('hybrid', {}), modeFor('decision', undefined), modeFor('shadow', undefined), modeFor('llm', {})]).toEqual(['llm', 'hybrid', 'decision', 'shadow', 'llm'])
  })
})
