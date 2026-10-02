import { describe, expect, it } from 'vitest'
import { cardsThatFit } from '../../../../src/client/pages/worlds/grid-layout.ts'

const metrics = { cardWidth: 100, cardHeight: 200, gap: 20 }

describe('cardsThatFit', () => {
  it('counts whole columns and rows including the gaps between them', () => {
    // 3 columns need 100*3 + 20*2 = 340; 2 rows need 200*2 + 20 = 420
    expect(cardsThatFit({ width: 340, height: 420 }, metrics)).toBe(6)
    expect(cardsThatFit({ width: 339, height: 420 }, metrics)).toBe(4)
    expect(cardsThatFit({ width: 340, height: 419 }, metrics)).toBe(3)
  })

  it('is zero when not even one card fits', () => {
    expect(cardsThatFit({ width: 50, height: 500 }, metrics)).toBe(0)
    expect(cardsThatFit({ width: 500, height: 50 }, metrics)).toBe(0)
    expect(cardsThatFit({ width: 0, height: 0 }, metrics)).toBe(0)
  })
})
