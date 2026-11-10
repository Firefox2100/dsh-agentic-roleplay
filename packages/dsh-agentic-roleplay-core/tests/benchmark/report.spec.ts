import { describe, expect, it } from 'vitest'
import { byKind, describeKinds, flaky } from './report.ts'
import type { RowRun } from './rows-run.ts'

const run = (row: string, language: string, verdicts: [string, string, boolean | undefined][], planted = false): RowRun => ({
  row, language, run: 1, data: 'x', score: undefined, turns: [], seconds: 0,
  verdicts: verdicts.map(([where, type, held]) => ({ where, expectation: { type } as never, held })),
  ...planted ? { planted: { what: 'p', outcome: 'caught' as const } } : {},
})
const themes: Record<string, string> = { a: 'mystery', b: 'daily', p: 'mystery' }

describe('what repeated runs add up to', () => {
  const runs = [
    run('a', 'en', [['turn 1', 'narration-clean', true], ['story', 'trigger-fired', false]]),
    run('a', 'en', [['turn 1', 'narration-clean', true], ['story', 'trigger-fired', true]]),
    run('b', 'zh', [['turn 1', 'narration-clean', false], ['story', 'value-changed', undefined]]),
    run('p', 'en', [['turn 1', 'narration-clean', false]], true),
  ]

  it('tallies each kind by language and theme, apart, leaving planted rows out and counting what was not judged on its own', () => {
    expect(byKind(runs, row => themes[row]!)).toEqual([
      { kind: 'narration-clean', language: 'en', theme: 'mystery', held: 2, failed: 0, unjudged: 0 },
      { kind: 'narration-clean', language: 'zh', theme: 'daily', held: 0, failed: 1, unjudged: 0 },
      { kind: 'trigger-fired', language: 'en', theme: 'mystery', held: 1, failed: 1, unjudged: 0 },
      { kind: 'value-changed', language: 'zh', theme: 'daily', held: 0, failed: 0, unjudged: 1 },
    ])
  })

  it('names the expectations that held in some repeats and failed in others', () => {
    expect(flaky(runs)).toEqual([{ row: 'a', where: 'story', expectation: 'trigger-fired', held: 1, failed: 1 }])
  })

  it('writes a line a kind, with n/a where nothing could be judged', () => {
    const lines = describeKinds(byKind(runs, row => themes[row]!))
    expect(lines[0]).toContain('100%')
    expect(lines[3]).toContain('n/a')
  })
})
