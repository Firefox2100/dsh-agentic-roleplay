import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ImportCardError } from '../../../src/host/import/card.ts'
import { ImportStaging, parseSelectionChoice } from '../../../src/host/import/staging.ts'
import { ImportNotFoundError } from '../../../src/host/import/store.ts'
import { readLorebook } from '../../../src/host/import/lorebook.ts'
import { readPreset } from '../../../src/host/import/preset.ts'

const file = (value: unknown): Buffer => Buffer.from(JSON.stringify(value))
const PRESET = file({ name: 'Bank', temperature: 0.9, prompts: [{ identifier: 'a', name: 'A', content: 'One.' }, { identifier: 'b', name: 'B', content: 'Two.' }], prompt_order: [{ character_id: 1, order: [{ identifier: 'a', enabled: true }, { identifier: 'b', enabled: false }] }] })
const BOOK = file({ name: 'Harbor', entries: [{ comment: 'One', content: 'Fact one.' }, { comment: 'Two', content: 'Fact two.' }] })

describe('files waiting for a choice', () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers() })

  it('shows what a file offers, with the sampling it asks, and hands out only what is chosen', () => {
    const staging = new ImportStaging()
    const preview = staging.stage('preset', PRESET, 'bank.json')
    expect(preview).toMatchObject({ kind: 'preset', name: 'Bank', sampling: { master: 0.9, characters: 0.9 } })
    expect(preview.items.map(item => [item.id, item.enabled])).toEqual([['a', true], ['b', false]])
    const chosen = staging.choose('preset', { id: preview.id, enabled: ['b'], sampling: false })
    expect(readPreset(chosen.file, 'x')).toMatchObject({ pieces: ['[B]\nTwo.'], sampling: {} })
    expect(readPreset(staging.choose('preset', { id: preview.id, enabled: ['a'], sampling: true }).file, 'x').sampling).toEqual({ master: 0.9, characters: 0.9 })

    const book = staging.stage('lorebook', BOOK, 'book.json')
    expect(book.sampling).toBeUndefined()
    expect(readLorebook(staging.choose('lorebook', { id: book.id, enabled: ['1'], sampling: false }).file, 'b').entries.map(entry => entry.text)).toEqual(['Fact two.'])
  })

  it('refuses a file that is not of the kind, a choice for another kind, a forgotten file and an unusable choice', () => {
    const staging = new ImportStaging()
    expect(() => staging.stage('lorebook', PRESET, 'x.json')).toThrow(ImportCardError)
    const preview = staging.stage('preset', PRESET, 'bank.json')
    expect(() => staging.choose('lorebook', { id: preview.id, enabled: ['0'], sampling: true })).toThrow(ImportNotFoundError)
    expect(() => staging.choose('preset', { id: preview.id, enabled: [], sampling: true })).toThrow('choose at least one')
    staging.discard(preview.id)
    expect(() => staging.choose('preset', { id: preview.id, enabled: ['a'], sampling: true })).toThrow('upload it again')
  })

  it('forgets a file after an hour and keeps at most a dozen', () => {
    const staging = new ImportStaging()
    const first = staging.stage('preset', PRESET, 'a.json')
    vi.advanceTimersByTime(61 * 60 * 1000)
    expect(() => staging.choose('preset', { id: first.id, enabled: ['a'], sampling: true })).toThrow(ImportNotFoundError)
    const ids = Array.from({ length: 13 }, () => staging.stage('preset', PRESET, 'a.json').id)
    expect(() => staging.choose('preset', { id: ids[0]!, enabled: ['a'], sampling: true })).toThrow(ImportNotFoundError)
    expect(staging.choose('preset', { id: ids[12]!, enabled: ['a'], sampling: true }).name).toBe('a.json')
  })
})

describe('reading a choice', () => {
  it('takes the staged id, the chosen ids and whether the sampling stays, which it does unless told otherwise', () => {
    expect(parseSelectionChoice({ id: 's', enabled: ['a'] })).toEqual({ id: 's', enabled: ['a'], sampling: true })
    expect(parseSelectionChoice({ id: 's', enabled: [], sampling: false })).toEqual({ id: 's', enabled: [], sampling: false })
    for (const bad of [null, [], { enabled: [] }, { id: 's', enabled: 'a' }, { id: 's', enabled: [1] }, { id: 's', enabled: [], sampling: 'no' }]) expect(typeof parseSelectionChoice(bad)).toBe('string')
  })
})
