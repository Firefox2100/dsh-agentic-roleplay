import { describe, expect, it } from 'vitest'
import { rowsThatFit } from '../../../../src/client/pages/sessions/row-layout.ts'

const metrics = { rowHeight: 40, headerHeight: 32 }

describe('rowsThatFit', () => {
  it('counts whole rows below the header', () => {
    expect(rowsThatFit({ width: 800, height: 32 + 40 * 5 }, metrics)).toBe(5)
    expect(rowsThatFit({ width: 800, height: 32 + 40 * 5 - 1 }, metrics)).toBe(4)
  })

  it('is zero when not even one row fits', () => {
    expect(rowsThatFit({ width: 800, height: 60 }, metrics)).toBe(0)
    expect(rowsThatFit({ width: 800, height: 10 }, metrics)).toBe(0)
    expect(rowsThatFit({ width: 800, height: 0 }, metrics)).toBe(0)
  })
})
