import { describe, expect, it } from 'vitest'
import { MAX_OWN_PINS, parsePins, pinsOf, ruledPinsOf } from '../../src/shared/pins.ts'
import { DEFAULT_SETTINGS, parseSettings } from '../../src/shared/settings.ts'

describe('pins', () => {
  it('are the player\'s lines, one fact each, without blanks', () => {
    expect(pinsOf('  The door stays locked.\n\n\nNo guns. \n')).toEqual(['The door stays locked.', 'No guns.'])
    expect(pinsOf('')).toEqual([])
  })

  it('can be soft: told like any pin, but not held against the player\'s actions', () => {
    const own = 'The door stays locked.\n~ She is usually late.\n~'
    expect(parsePins(own)).toEqual([{ text: 'The door stays locked.', soft: false }, { text: 'She is usually late.', soft: true }])
    expect(pinsOf(own)).toHaveLength(2)
    expect(ruledPinsOf(own)).toEqual(['The door stays locked.'])
  })

  it('are a setting that starts empty and is read as written', () => {
    expect(DEFAULT_SETTINGS.pins.own).toBe('')
    const parsed = parseSettings({ pins: { own: 'A fact.' } })
    expect(parsed.ok && parsed.value.pins.own).toBe('A fact.')
    expect(MAX_OWN_PINS).toBeGreaterThan(0)
  })
})
