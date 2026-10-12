import { describe, expect, it } from 'vitest'
import { NEW, declarationOf, draftOf } from '../../../src/client/world-editor/variables-draft.ts'

describe('a variable as it is typed', () => {
  it('becomes a declaration with only what applies to its kind', () => {
    expect(declarationOf({ ...NEW, key: ' mood ', name: 'Mood', min: '0', max: '10', default: '5', integer: true, bands: '3: low\n10: high\nnonsense', options: 'a, b' }))
      .toEqual({ key: 'mood', name: 'Mood', kind: 'number', subject: 'character', visibility: 'public', min: 0, max: 10, integer: true, default: 5, bands: [{ up_to: 3, label: 'low' }, { up_to: 10, label: 'high' }] })
    expect(declarationOf({ ...NEW, key: 'door', name: 'Door', kind: 'flag', subject: 'item', default: 'true', min: '3', integer: true }))
      .toEqual({ key: 'door', name: 'Door', kind: 'flag', subject: 'item', visibility: 'public', default: true })
    expect(declarationOf({ ...NEW, key: 'stance', name: 'Stance', kind: 'choice', options: 'calm, angry', only: 'clara, bob', default: 'calm' }))
      .toMatchObject({ options: ['calm', 'angry'], only: ['clara', 'bob'], default: 'calm' })
  })

  it('round-trips through the form unchanged', () => {
    const declaration = { key: 'mood', name: 'Mood', kind: 'number' as const, subject: 'character' as const, visibility: 'private' as const, description: 'How it feels', min: 0, max: 10, baseline: true, bands: [{ up_to: 10, label: 'fine' }] }
    expect(declarationOf(draftOf(declaration))).toEqual(declaration)
  })
})
