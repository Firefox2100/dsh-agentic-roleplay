import { describe, expect, it } from 'vitest'
import { layoutRelations } from '../../../src/client/reference/relations-layout.ts'

describe('the relations layout', () => {
  it('puts one person above the centre and spreads several evenly on a ring', () => {
    const one = layoutRelations(['a'])
    expect(one.nodes[0]!.x).toBe(one.centre.x)
    expect(one.nodes[0]!.y).toBeLessThan(one.centre.y)
    const four = layoutRelations(['a', 'b', 'c', 'd'])
    expect(four.nodes.map(node => node.key)).toEqual(['a', 'b', 'c', 'd'])
    expect(four.nodes[2]!.y).toBeGreaterThan(four.centre.y)
  })

  it('widens the ring for a crowd so that the people do not overlap, and fits all of them in the drawing', () => {
    const crowd = layoutRelations(Array.from({ length: 30 }, (_, i) => String(i)))
    const calm = layoutRelations(['a', 'b'])
    expect(crowd.width).toBeGreaterThan(calm.width)
    expect(crowd.nodes.every(node => node.x > 0 && node.x < crowd.width && node.y > 0 && node.y < crowd.height)).toBe(true)
  })

  it('draws nothing but the centre for nobody', () => {
    expect(layoutRelations([]).nodes).toEqual([])
  })
})
