import { describe, expect, it } from 'vitest'
import { InvalidEditProblems, parseRelationEdit } from '../../src/shared/world-state.ts'

describe('relation edits', () => {
  it('tells a model that sends a key with ends that are not the key\'s how to change and how to create', () => {
    expect(() => parseRelationEdit({ kind: 'character', key: 'character:a:b', from: 'a', to: 'c', label: 'friend' })).toThrow(InvalidEditProblems)
    try { parseRelationEdit({ kind: 'character', key: 'character:a:b', from: 'a', to: 'c', label: 'friend' }) } catch (error) {
      const said = (error as InvalidEditProblems).problems.join(' ')
      expect(said).toContain('to does not match the key')
      expect(said).toContain('send {kind, key, label}')
    }
  })

  it('takes an edit that repeats the ends its key names', () => {
    expect(() => parseRelationEdit({ kind: 'character', key: 'character:a:b', from: 'a', to: 'b', label: 'rival' })).not.toThrow()
    expect(() => parseRelationEdit({ kind: 'social', key: 'social:guild:faction:order', from: 'guild', to: 'order', fromKind: 'faction', toKind: 'faction', label: 'ally' })).not.toThrow()
  })

  it('accepts a creation without a key and a change by a key', () => {
    expect(() => parseRelationEdit({ create: true, kind: 'character', from: 'a', to: 'b', label: 'friend' })).not.toThrow()
    expect(() => parseRelationEdit({ kind: 'character', key: 'character:a:b', label: 'rival' })).not.toThrow()
  })
})
