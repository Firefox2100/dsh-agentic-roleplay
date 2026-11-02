import { describe, expect, it } from 'vitest'
import { fitLabel, layoutMap } from '../../../src/client/reference/map-layout.ts'

const at = (layout: ReturnType<typeof layoutMap>, key: string) => layout.nodes.find(node => node.key === key)!

describe('the map layout', () => {
  it('puts the places by how far they are from where the player is, in both directions of a way', () => {
    const layout = layoutMap(
      [{ key: 'square', here: false }, { key: 'bar', here: true }, { key: 'cellar', here: false }, { key: 'alley', here: false }],
      [{ from: 'bar', to: 'square', open: true }, { from: 'cellar', to: 'bar', open: false }, { from: 'alley', to: 'square', open: true }],
    )
    expect(at(layout, 'bar').x).toBeLessThan(at(layout, 'square').x)
    expect(at(layout, 'square').x).toBe(at(layout, 'cellar').x)
    expect(at(layout, 'alley').x).toBeGreaterThan(at(layout, 'square').x)
    expect(at(layout, 'square').y).not.toBe(at(layout, 'cellar').y)
  })

  it('joins two places once however many ways there are, open if any is', () => {
    const layout = layoutMap([{ key: 'a', here: true }, { key: 'b', here: false }], [{ from: 'a', to: 'b', open: false }, { from: 'b', to: 'a', open: true }])
    expect(layout.links).toEqual([{ from: 'b', to: 'a', open: true }])
  })

  it('sets places no known way reaches after the reachable ones, and ignores ways to places that are not on the map', () => {
    const layout = layoutMap([{ key: 'a', here: true }, { key: 'b', here: false }, { key: 'far', here: false }], [{ from: 'a', to: 'b', open: true }, { from: 'a', to: 'ghost', open: true }])
    expect(at(layout, 'far').x).toBeGreaterThan(at(layout, 'b').x)
    expect(layout.links).toHaveLength(1)
  })

  it('is empty for no places', () => {
    expect(layoutMap([], [])).toMatchObject({ nodes: [], links: [] })
  })
})

describe('the label of a place', () => {
  it('keeps a short name, cuts a long one, and counts Chinese characters double', () => {
    expect(fitLabel('Town Square')).toBe('Town Square')
    expect(fitLabel('The Very Long Name Of A Place')).toBe('The Very Long Name Of…')
    expect(fitLabel('千子树下的祭祀场所和旧宅')).toBe('千子树下的祭祀场所和旧…')
  })
})
