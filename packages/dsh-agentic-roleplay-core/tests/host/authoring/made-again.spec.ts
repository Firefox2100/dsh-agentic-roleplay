import { describe, expect, it } from 'vitest'
import { madeAgain } from '../../../src/host/authoring/author-agent.ts'

describe('what the author made in a run and asks for again', () => {
  const work = { created: [{ kind: 'character' as const, key: 'margot' }, { kind: 'place' as const, key: 'dock' }] }

  it('names the people, places and things of an edit that were made already, once each', () => {
    expect(madeAgain({ characters: [{ key: 'margot', name: 'M' }, { key: 'tom' }], places: [{ key: 'dock' }, { key: 'dock' }], items: [{ key: 'note' }] }, work)).toEqual(['margot', 'dock'])
  })

  it('has nothing to say about an edit that only connects what exists, or that is not shaped as expected', () => {
    expect(madeAgain({ relationships: [{ from: 'margot', to: 'tom', label: 'x' }] }, work)).toEqual([])
    expect(madeAgain({ characters: 'margot', places: [null, 3, { key: 4 }] }, work)).toEqual([])
    expect(madeAgain({}, { created: [] })).toEqual([])
  })
})
