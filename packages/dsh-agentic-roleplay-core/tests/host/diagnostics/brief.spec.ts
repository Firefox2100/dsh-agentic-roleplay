import { describe, expect, it } from 'vitest'
import { briefSections } from '../../../src/host/diagnostics/estimate.ts'
import { childTrace } from '../../../src/host/agents/child.ts'
import type { ActivityEntry, RunDetail } from '../../../src/shared/activity.ts'

const brief = [
  'Situation:\nThe quay at dusk.',
  'Where you are:\nA bar.\nTwo exits.',
  'Present:\n- Clara\n- Tomas',
  'A line with no heading that belongs to Present.',
  'What you remember that bears on this: nothing comes to mind.',
].join('\n\n')

describe('the parts of a helper\'s brief', () => {
  it('divides it at the paragraphs that open with a heading, and keeps what follows a heading with it', () => {
    const parts = briefSections(brief)
    expect(parts.map(part => part.title)).toEqual(['Situation', 'Where you are', 'Present'])
    expect(parts[2]!.tokens).toBeGreaterThan(parts[0]!.tokens)
  })

  it('names text before the first heading as the opening, reads full-width colons, and caps the number of parts', () => {
    expect(briefSections('Just text.\n\n情景：\n夜里的码头。').map(part => part.title)).toEqual(['', '情景'])
    expect(briefSections(Array.from({ length: 40 }, (_, index) => `Part ${index}:\nx`).join('\n\n'))).toHaveLength(24)
    expect(briefSections('')).toEqual([])
  })
})

describe('the record of a helper\'s run', () => {
  const recorded = (cause?: string): ActivityEntry => {
    let entry: ActivityEntry | undefined
    const store = { settings: () => ({ models: { characters: '' }, diagnostics: { keepRuns: false } }), recordActivity: (made: ActivityEntry) => { entry = made } }
    const detail: RunDetail = { persona: 'p', prompt: brief, calls: [] }
    childTrace(store as never, 'characters', 'Clara', {}, undefined, cause)({ ms: 5, calls: 1, detail, turn: 7, tokens: { input: 1, cached: 0, output: 1 } } as never)
    return entry!
  }

  it('carries the parts of the brief and what set an off-stage run off', () => {
    expect(recorded('off stage')).toMatchObject({ label: 'Clara', cause: 'off stage', turn: 7, brief: [{ title: 'Situation' }, { title: 'Where you are' }, { title: 'Present' }] })
    expect(recorded().cause).toBeUndefined()
  })
})
