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

  it('takes a model as provider/model, or empty for the chat\'s own', () => {
    expect(parseSettings({ models: { characters: 'localai/qwen 3', records: '' } }).ok).toBe(false)
    expect(parseSettings({ models: { characters: 'localai/qwen' } })).toEqual({ ok: true, value: { ...DEFAULT_SETTINGS, models: { ...DEFAULT_SETTINGS.models, characters: 'localai/qwen' } } })
    for (const bad of ['qwen', '/qwen', 'localai/']) expect(parseSettings({ models: { records: bad } })).toEqual({ ok: false, problems: ['"models.records" must be written provider/model, for example localai/qwen'] })
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



describe('the options of the embedding provider', () => {
  it('are none by default, and kept as given when they are numbers, text or flags', () => {
    expect(DEFAULT_SETTINGS.embedding).toEqual({ options: {} })
    const given = { embedding: { options: { dimensions: 256, user: 'u', normalize: true } } }
    expect(parseSettings(given)).toEqual({ ok: true, value: { ...DEFAULT_SETTINGS, ...given } })
    expect(parseSettings({}).ok && (parseSettings({}) as { value: typeof DEFAULT_SETTINGS }).value.embedding.options).toEqual({})
  })

  it('are not shared between settings: a default is a fresh object', () => {
    const first = parseSettings({}) as { ok: true; value: typeof DEFAULT_SETTINGS }
    first.value.embedding.options['x'] = 1
    expect((parseSettings({}) as { ok: true; value: typeof DEFAULT_SETTINGS }).value.embedding.options).toEqual({})
  })

  it('are refused when they are not a flat set of values under plain names, or too many', () => {
    const bad = 'must be a number, text or true/false, under a name of letters, digits and underscores'
    expect(parseSettings({ embedding: { options: { nested: { a: 1 } } } })).toEqual({ ok: false, problems: [`"embedding.options.nested" ${bad}`] })
    expect(parseSettings({ embedding: { options: { 'bad name': 1 } } })).toEqual({ ok: false, problems: [`"embedding.options.bad name" ${bad}`] })
    expect(parseSettings({ embedding: { options: { x: Number.NaN } } }).ok).toBe(false)
    expect(parseSettings({ embedding: { options: [1] } })).toEqual({ ok: false, problems: ['"embedding.options" must be an object'] })
    expect(parseSettings({ embedding: { options: Object.fromEntries(Array.from({ length: 21 }, (_, index) => [`o${index}`, index])) } })).toEqual({ ok: false, problems: ['"embedding.options" may have at most 20 options'] })
    expect(parseSettings({ embedding: { colour: 1 } })).toEqual({ ok: false, problems: ['"embedding.colour" is not a setting'] })
  })
})

describe('the clock settings', () => {
  it('are simulated time in UTC by default, a round taking half a minute', () => {
    expect(DEFAULT_SETTINGS.clock).toEqual({ mode: 'simulated', timeZone: '', roundSeconds: 30, maxSkipDays: 30 })
  })

  it('take a mode, a time zone and bounds, and refuse the rest', () => {
    const ok = parseSettings({ clock: { mode: 'real', timeZone: 'Asia/Shanghai', roundSeconds: 0, maxSkipDays: 365 } })
    expect(ok).toEqual({ ok: true, value: expect.objectContaining({ clock: { mode: 'real', timeZone: 'Asia/Shanghai', roundSeconds: 0, maxSkipDays: 365 } }) })
    const bad = parseSettings({ clock: { mode: 'fast', timeZone: 'Mars/Olympus', roundSeconds: 4000, maxSkipDays: 0 } })
    expect(bad).toEqual({ ok: false, problems: [
      '"clock.mode" must be one of: simulated, real',
      '"clock.roundSeconds" must be a whole number from 0 to 3600',
      '"clock.maxSkipDays" must be a whole number from 1 to 3650',
      expect.stringContaining('"clock.timeZone" is not a time zone'),
    ] })
    expect(parseSettings({ clock: { timeZone: 5 } })).toEqual({ ok: false, problems: ['"clock.timeZone" must be text of at most 64 characters'] })
  })
})

describe('the off stage setting', () => {
  it('is two characters per turn by default, from none to five', () => {
    expect(DEFAULT_SETTINGS.offstage).toEqual({ perTurn: 2, perCharacter: 1, joint: true, summary: true })
    expect(parseSettings({ offstage: { perTurn: 0 } }).ok).toBe(true)
    expect(parseSettings({ offstage: { perTurn: 6 } })).toEqual({ ok: false, problems: ['"offstage.perTurn" must be a whole number from 0 to 5'] })
  })
})
