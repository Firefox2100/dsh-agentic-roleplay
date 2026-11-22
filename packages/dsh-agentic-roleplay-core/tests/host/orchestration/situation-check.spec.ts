import { describe, expect, it } from 'vitest'
import type { TurnStore } from '../../../src/host/orchestration/boundaries.ts'
import { unknownNames, unknownProblem } from '../../../src/host/orchestration/situation-check.ts'
import { alice, bob, carol, location, placed } from './fixtures.ts'

const room = location(1, 'Room')
const away = location(2, 'Away')

function storeOf(knows: Record<number, number[]>, here: Record<number, typeof alice[]>): TurnStore {
  return {
    story: { relationships: { from: (id: number) => (knows[id] ?? []).map(toId => ({ toId })) } },
    place: (id: number) => ({ here: (here[id] ?? []).map(member => placed(member, id === 1 ? room : away)) }),
  } as unknown as TurnStore
}

describe('who a situation names without the recipient knowing them', () => {
  const cast = [placed(alice, room), placed(carol, away), placed(bob, room)]
  const store = storeOf({}, { 1: [alice, bob], 2: [carol] })

  it('finds a person the recipient has no edge to and is not with', () => {
    const found = unknownNames('Bob asks Alice whether Carol may come.', [cast[0]!], cast, store, new Map())
    expect(found).toEqual([{ recipient: cast[0]!.key, names: [cast[1]!.key] }])
    expect(unknownProblem(found, cast)).toMatch(/Alice has no way of knowing Carol/)
  })

  it('lets through people the recipient knows or stands with, and the recipient itself', () => {
    expect(unknownNames('Bob greets Alice.', [cast[0]!], cast, store, new Map())).toEqual([])
    expect(unknownNames('Carol is mentioned.', [cast[0]!], cast, storeOf({ [alice.character.id]: [carol.character.id] }, { 1: [alice, bob] }), new Map())).toEqual([])
  })

  it('refuses a pair twice and then lets it through', () => {
    const refused = new Map([[`${cast[0]!.key}|${cast[1]!.key}`, 2]])
    expect(unknownNames('Carol is mentioned.', [cast[0]!], cast, store, new Map([[`${cast[0]!.key}|${cast[1]!.key}`, 1]]))).toHaveLength(1)
    expect(unknownNames('Carol is mentioned.', [cast[0]!], cast, store, refused)).toEqual([])
  })
})
