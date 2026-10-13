import { describe, expect, it } from 'vitest'
import { childTrace } from '../../../src/host/agents/child.ts'
import { readActivity, recordActivity } from '../../../src/host/sessions/activity.ts'
import { DEFAULT_SETTINGS } from '../../../src/shared/settings.ts'
import { MAX_ACTIVITY, type ActivityEntry } from '../../../src/shared/activity.ts'

function session() {
  const values = new Map<string, unknown>()
  return { metadata: { getValue: (key: string) => values.get(key), setValue: (key: string, value: unknown) => { values.set(key, value) } } }
}

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
    childTrace(store, 'records', 'record keeper')({ ms: 1200, calls: 4 })
    childTrace(store, 'characters', 'Clara')({ ms: 50, calls: 1, error: 'x'.repeat(400) })
    expect(filed[0]).toMatchObject({ label: 'record keeper', model: 'localai/small', ms: 1200, calls: 4 })
    expect(filed[0]).not.toHaveProperty('error')
    expect(filed[1]).toMatchObject({ label: 'Clara', model: '' })
    expect(filed[1]?.error).toHaveLength(300)
  })
})
