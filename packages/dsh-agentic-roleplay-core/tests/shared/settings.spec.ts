import { describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS, SETTINGS_SPEC, parseSettings } from '../../src/shared/settings.ts'

describe('parseSettings', () => {
  it('takes the defaults for what is left out, at any depth', () => {
    expect(parseSettings({})).toEqual({ ok: true, value: DEFAULT_SETTINGS })
    const partial = parseSettings({ maxRounds: 5, memory: { flaky: false } })
    expect(partial).toEqual({ ok: true, value: { ...DEFAULT_SETTINGS, maxRounds: 5, memory: { ...DEFAULT_SETTINGS.memory, flaky: false } } })
  })

  it('has memory that fades and a context that folds by default', () => {
    expect(DEFAULT_SETTINGS.memory.flaky).toBe(true)
    expect(DEFAULT_SETTINGS.context.retainRatio).toBe(0.5)
  })

  it('accepts the bounds and nothing outside them', () => {
    const { maxRounds } = SETTINGS_SPEC
    expect(parseSettings({ maxRounds: maxRounds.min }).ok).toBe(true)
    expect(parseSettings({ maxRounds: maxRounds.max }).ok).toBe(true)
    for (const bad of [0, maxRounds.max + 1, 2.5, -1, '3', null, Number.NaN]) {
      expect(parseSettings({ maxRounds: bad })).toEqual({ ok: false, problems: ['"maxRounds" must be a whole number from 1 to 10'] })
    }
    expect(parseSettings({ context: { retainRatio: 0.95 } })).toEqual({ ok: false, problems: ['"context.retainRatio" must be a number from 0.1 to 0.9'] })
    expect(parseSettings({ context: { retainRatio: 0.25 } }).ok).toBe(true)
    expect(parseSettings({ memory: { recall: 0 } })).toEqual({ ok: false, problems: ['"memory.recall" must be a whole number from 1 to 30'] })
  })

  it('wants a true or false for a flag', () => {
    expect(parseSettings({ memory: { flaky: 'no' } })).toEqual({ ok: false, problems: ['"memory.flaky" must be true or false'] })
  })

  it('refuses what is not a setting, at any depth, and what is not an object', () => {
    expect(parseSettings({ maxRounds: 2, colour: 'red' })).toEqual({ ok: false, problems: ['"colour" is not a setting'] })
    expect(parseSettings({ memory: { colour: 1 } })).toEqual({ ok: false, problems: ['"memory.colour" is not a setting'] })
    expect(parseSettings({ memory: 3 })).toEqual({ ok: false, problems: ['"memory" must be an object'] })
    for (const bad of [null, [], 'x', 3]) expect(parseSettings(bad)).toEqual({ ok: false, problems: ['the settings must be an object'] })
  })
})
