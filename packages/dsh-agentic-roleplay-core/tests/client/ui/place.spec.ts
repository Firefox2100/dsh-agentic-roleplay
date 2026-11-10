import { describe, expect, it } from 'vitest'
import { MARGIN, place, type AnchorRect } from '../../../src/client/ui/place.ts'
import { isWalkKey, walk } from '../../../src/client/ui/walk.ts'

function anchor(left: number, top: number, width = 40, height = 20): AnchorRect {
  return { left, top, right: left + width, bottom: top + height, width, height }
}

const VIEWPORT = { width: 800, height: 600 }

describe('tooltip placement', () => {
  it('puts the bubble on the preferred side when it fits', () => {
    expect(place(anchor(100, 100), { width: 100, height: 40 }, 'right', 8, VIEWPORT)).toEqual({ left: 148, top: 90 })
    expect(place(anchor(100, 100), { width: 100, height: 40 }, 'bottom', 8, VIEWPORT)).toEqual({ left: 70, top: 128 })
  })

  it('flips to the opposite side when the preferred one leaves the viewport', () => {
    // The right edge is too close: the bubble goes to the left of the anchor instead of overflowing.
    expect(place(anchor(720, 100), { width: 100, height: 40 }, 'right', 8, VIEWPORT).left).toBe(612)
    // A top bubble would sit above the viewport: it goes below the anchor.
    expect(place(anchor(100, 4), { width: 100, height: 40 }, 'top', 8, VIEWPORT).top).toBe(32)
    // A bottom bubble would run past the bottom edge: it goes above the anchor.
    expect(place(anchor(100, 540), { width: 100, height: 40 }, 'bottom', 8, VIEWPORT).top).toBe(492)
  })

  it('clamps a centered bubble into the viewport on both axes', () => {
    const farRight = place(anchor(760, 100), { width: 100, height: 40 }, 'top', 8, VIEWPORT)
    expect(farRight.left).toBe(VIEWPORT.width - MARGIN - 100)
    const nearTop = place(anchor(100, 0), { width: 100, height: 40 }, 'bottom', 8, { width: 800, height: 20 })
    expect(nearTop.top).toBe(MARGIN)
  })

  it('keeps the preferred side exactly when no viewport is measured', () => {
    expect(place(anchor(0, 2), { width: 100, height: 40 }, 'top', 8)).toEqual({ left: -30, top: -46 })
  })
})

describe('segmented control walking', () => {
  const options = [{ value: 'a' }, { value: 'b' }, { value: 'c' }] as const
  const gapped = [{ value: 'a' }, { value: 'b', disabled: true }, { value: 'c' }] as const

  it('recognises the walk keys only', () => {
    for (const key of ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End']) expect(isWalkKey(key)).toBe(true)
    for (const key of ['a', 'Tab', 'Enter', ' ']) expect(isWalkKey(key)).toBe(false)
  })

  it('steps to the next and previous segment with wrapping', () => {
    expect(walk(options, 0, 'ArrowRight')?.value).toBe('b')
    expect(walk(options, 2, 'ArrowRight')?.value).toBe('a')
    expect(walk(options, 0, 'ArrowLeft')?.value).toBe('c')
    expect(walk(options, 1, 'ArrowDown')?.value).toBe('c')
    expect(walk(options, 1, 'ArrowUp')?.value).toBe('a')
  })

  it('skips disabled segments', () => {
    expect(walk(gapped, 0, 'ArrowRight')?.value).toBe('c')
    expect(walk(gapped, 2, 'ArrowLeft')?.value).toBe('a')
  })

  it('lands on the first and last enabled segment for Home and End', () => {
    expect(walk(gapped, 2, 'Home')?.value).toBe('a')
    expect(walk([{ value: 'a', disabled: true }, { value: 'b' }, { value: 'c', disabled: true }], 1, 'End')?.value).toBe('b')
  })

  it('has nowhere to go when every segment is disabled', () => {
    expect(walk([{ value: 'a', disabled: true }, { value: 'b', disabled: true }], 0, 'ArrowRight')).toBeUndefined()
    expect(walk([{ value: 'a', disabled: true }], 0, 'Home')).toBeUndefined()
  })
})
