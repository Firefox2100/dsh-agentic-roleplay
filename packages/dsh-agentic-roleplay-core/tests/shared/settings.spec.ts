import { describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS, MAX_ROUNDS, MIN_ROUNDS, parseSettings } from '../../src/shared/settings.ts'

describe('parseSettings', () => {
  it('takes the defaults for what is left out', () => {
    expect(parseSettings({})).toEqual({ ok: true, value: DEFAULT_SETTINGS })
    expect(parseSettings({ maxRounds: 5 })).toEqual({ ok: true, value: { maxRounds: 5 } })
  })

  it('accepts the bounds and nothing outside them', () => {
    expect(parseSettings({ maxRounds: MIN_ROUNDS }).ok).toBe(true)
    expect(parseSettings({ maxRounds: MAX_ROUNDS }).ok).toBe(true)
    for (const bad of [0, MAX_ROUNDS + 1, 2.5, -1, '3', null, Number.NaN]) {
      expect(parseSettings({ maxRounds: bad })).toEqual({ ok: false, problems: [`"maxRounds" must be a whole number from ${MIN_ROUNDS} to ${MAX_ROUNDS}`] })
    }
  })

  it('refuses what is not a setting, and what is not an object', () => {
    expect(parseSettings({ maxRounds: 2, colour: 'red' })).toEqual({ ok: false, problems: ['"colour" is not a setting'] })
    for (const bad of [null, [], 'x', 3]) expect(parseSettings(bad)).toEqual({ ok: false, problems: ['the settings must be an object'] })
  })
})
