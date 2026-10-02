import { describe, expect, it } from 'vitest'
import { MIN_PAGE_SIZE, cardsThatFit, pageCount, pageStart, pagingFor } from '../../../../src/client/pages/worlds/grid-layout.ts'

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

describe('pagingFor', () => {
  it('uses exactly what fits when that reaches the minimum', () => {
    expect(pagingFor(MIN_PAGE_SIZE)).toEqual({ pageSize: MIN_PAGE_SIZE, scrolls: false })
    expect(pagingFor(24)).toEqual({ pageSize: 24, scrolls: false })
  })

  it('keeps the minimum page and scrolls when less fits', () => {
    expect(pagingFor(MIN_PAGE_SIZE - 1)).toEqual({ pageSize: MIN_PAGE_SIZE, scrolls: true })
    expect(pagingFor(0)).toEqual({ pageSize: MIN_PAGE_SIZE, scrolls: true })
  })
})

describe('pageCount', () => {
  it('is at least one page', () => {
    expect(pageCount(0, 10)).toBe(1)
    expect(pageCount(10, 10)).toBe(1)
    expect(pageCount(11, 10)).toBe(2)
  })
})

describe('pageStart', () => {
  it('snaps an index to the start of its page', () => {
    expect(pageStart(0, 50, 10)).toBe(0)
    expect(pageStart(27, 50, 10)).toBe(20)
  })

  it('keeps the same first card in view when the page size changes', () => {
    expect(pageStart(20, 50, 12)).toBe(12)
    expect(pageStart(20, 50, 7)).toBe(14)
  })

  it('never goes past the last page or below zero', () => {
    expect(pageStart(90, 25, 10)).toBe(20)
    expect(pageStart(-5, 25, 10)).toBe(0)
    expect(pageStart(10, 0, 10)).toBe(0)
  })
})
