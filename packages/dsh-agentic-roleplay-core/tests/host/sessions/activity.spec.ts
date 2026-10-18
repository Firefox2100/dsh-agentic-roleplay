import { mkdtempSync, existsSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { childTrace } from '../../../src/host/agents/child.ts'
import { forgetRunDetails, keepRunDetail, readActivity, readRunDetail, recordActivity } from '../../../src/host/sessions/activity.ts'
import { DEFAULT_SETTINGS } from '../../../src/shared/settings.ts'
import { MAX_ACTIVITY, type ActivityEntry, type RunDetail } from '../../../src/shared/activity.ts'

function session() {
  const values = new Map<string, unknown>()
  return { metadata: { getValue: (key: string) => values.get(key), setValue: (key: string, value: unknown) => { values.set(key, value) } } }
}

const detail: RunDetail = { persona: 'who', prompt: 'what', calls: [{ tool: 'recall', args: '{}', outcome: 'nothing', failed: false }], result: '{}' }
const entry = (n: number): ActivityEntry => ({ at: n, label: `helper ${n}`, model: '', ms: n, calls: 1 })

describe('the record of what the helpers did', () => {
  it('keeps the latest runs, oldest first, and drops the oldest past the limit', () => {
    const s = session()
    for (let n = 1; n <= MAX_ACTIVITY + 5; n += 1) recordActivity(s, entry(n))
    const kept = readActivity(s)
    expect(kept).toHaveLength(MAX_ACTIVITY)
    expect(kept[0]?.at).toBe(6)
    expect(kept.at(-1)?.at).toBe(MAX_ACTIVITY + 5)
  })

  it('ignores stored rows that are not runs', () => {
    const s = session()
    s.metadata.setValue('activity', [entry(1), { at: 'x' }, null])
    expect(readActivity(s)).toEqual([entry(1)])
  })
})

describe('childTrace', () => {
  it('files a run under its label with the model of its kind, and the reason when it failed', () => {
    const filed: ActivityEntry[] = []
    const store = { settings: () => ({ ...DEFAULT_SETTINGS, models: { ...DEFAULT_SETTINGS.models, records: ' localai/small ' } }), recordActivity: (item: ActivityEntry) => { filed.push(item) } }
    childTrace(store, 'records', 'record keeper')({ ms: 1200, calls: 4, detail, turn: 1, tokens: { input: 10, cached: 2, output: 5 } })
    childTrace(store, 'characters', 'Clara')({ ms: 50, calls: 1, error: 'x'.repeat(400), detail, turn: 1, tokens: { input: 10, cached: 2, output: 5 } })
    expect(filed[0]).toMatchObject({ label: 'record keeper', model: 'localai/small', ms: 1200, calls: 4, turn: 1, tokens: { input: 10, cached: 2, output: 5 } })
    expect(filed[0]).not.toHaveProperty('error')
    expect(filed[1]).toMatchObject({ label: 'Clara', model: '' })
    expect(filed[1]?.error).toHaveLength(300)
  })
})

describe('the detail of a run', () => {
  const folder = () => mkdtempSync(join(tmpdir(), 'run-detail-'))
  const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`

  it('is filed only when the chat keeps runs, under the run named in the record', () => {
    const filed: { entry: ActivityEntry; detail?: RunDetail }[] = []
    const on = { settings: () => ({ ...DEFAULT_SETTINGS, diagnostics: { keepRuns: true } }), recordActivity: (entry: ActivityEntry, kept?: RunDetail) => { filed.push({ entry, ...(kept === undefined ? {} : { detail: kept }) }) } }
    const off = { ...on, settings: () => DEFAULT_SETTINGS, recordActivity: on.recordActivity }
    childTrace(on, 'characters', 'Clara')({ ms: 1, calls: 1, detail, turn: 1, tokens: { input: 10, cached: 2, output: 5 } })
    childTrace(off, 'characters', 'Clara')({ ms: 1, calls: 1, detail, turn: 1, tokens: { input: 10, cached: 2, output: 5 } })
    expect(filed[0]?.entry.run).toMatch(/^[0-9a-f-]{36}$/)
    expect(filed[0]?.detail).toEqual(detail)
    expect(filed[1]?.entry).not.toHaveProperty('run')
    expect(filed[1]).not.toHaveProperty('detail')
  })

  it('carries what the character was reminded of beside the detail of the run', () => {
    const filed: RunDetail[] = []
    const reasons = { cues: { people: 3, words: 1, place: 0 }, relevance: 0.5, importance: 3, ageDays: 2, score: 7 }
    childTrace({ settings: () => ({ ...DEFAULT_SETTINGS, diagnostics: { keepRuns: true } }), recordActivity: (_entry, kept) => { if (kept !== undefined) filed.push(kept) } }, 'characters', 'Clara', { recalled: [{ clarity: 'clear', turn: 1, text: 'It was sealed.', why: reasons }] })({ ms: 1, calls: 0, detail, turn: 1, tokens: { input: 10, cached: 2, output: 5 } })
    expect(filed[0]?.recalled).toEqual([{ clarity: 'clear', turn: 1, text: 'It was sealed.', why: reasons }])
    expect(filed[0]?.prompt).toBe('what')
  })

  it('is read back, and missing when never kept, and refuses a name that is not a run', () => {
    const dir = folder()
    keepRunDetail(dir, id(1), detail)
    expect(readRunDetail(dir, id(1))).toEqual(detail)
    expect(readRunDetail(dir, id(2))).toBeUndefined()
    expect(() => readRunDetail(dir, '../session')).toThrow(RangeError)
    rmSync(dir, { recursive: true, force: true })
  })

  it('goes with the entry that falls off the end of the record', () => {
    const dir = folder()
    const s = session()
    for (let n = 1; n <= MAX_ACTIVITY + 1; n += 1) {
      const run = id(n)
      keepRunDetail(dir, run, detail)
      forgetRunDetails(dir, recordActivity(s, { ...entry(n), run }))
    }
    expect(existsSync(join(dir, 'activity', `${id(1)}.json`))).toBe(false)
    expect(readRunDetail(dir, id(2))).toEqual(detail)
    rmSync(dir, { recursive: true, force: true })
  })
})
