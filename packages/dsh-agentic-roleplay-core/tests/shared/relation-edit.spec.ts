import { describe, expect, it } from 'vitest'
import { InvalidEditProblems, parseRelationEdit } from '../../src/shared/world-state.ts'

describe('relation edits', () => {
  it('tells a model that sends a key together with from and to how to create and how to change', () => {
    expect(() => parseRelationEdit({ kind: 'character', key: 'character-a-b', from: 'a', to: 'b', label: 'friend' })).toThrow(InvalidEditProblems)
    try { parseRelationEdit({ kind: 'character', key: 'character-a-b', from: 'a', to: 'b', label: 'friend' }) } catch (error) {
      expect((error as InvalidEditProblems).problems.join(' ')).toContain('create: true with from and to and no key')
    }
  })

  it('accepts a creation without a key and a change by a key', () => {
    expect(() => parseRelationEdit({ create: true, kind: 'character', from: 'a', to: 'b', label: 'friend' })).not.toThrow()
    expect(() => parseRelationEdit({ kind: 'character', key: 'character:a:b', label: 'rival' })).not.toThrow()
  })
})
