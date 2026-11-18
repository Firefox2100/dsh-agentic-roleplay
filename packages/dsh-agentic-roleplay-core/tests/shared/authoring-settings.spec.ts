import { describe, expect, it } from 'vitest'
import { DEFAULT_KEEP_RESULT_TURNS, DEFAULT_TOOL_HIDING, MAX_KEEP_RESULT_TURNS, parseAuthoringSettings } from '../../src/shared/authoring-settings.ts'

describe('what an authoring chat keeps of a world', () => {
  it('starts on the hiding that only leaves out what cannot be used, and on two turns of results', () => {
    expect(DEFAULT_TOOL_HIDING).toBe('card')
    expect(DEFAULT_KEEP_RESULT_TURNS).toBe(2)
  })

  it('reads only the fields it was given', () => {
    expect(parseAuthoringSettings({})).toEqual({})
    expect(parseAuthoringSettings({ toolHiding: 'phase' })).toEqual({ toolHiding: 'phase' })
    expect(parseAuthoringSettings({ keepResultTurns: 0 })).toEqual({ keepResultTurns: 0 })
    expect(parseAuthoringSettings({ toolHiding: 'off', keepResultTurns: MAX_KEEP_RESULT_TURNS })).toEqual({ toolHiding: 'off', keepResultTurns: MAX_KEEP_RESULT_TURNS })
    expect(parseAuthoringSettings({ toolHiding: undefined, keepResultTurns: undefined })).toEqual({})
  })

  it('refuses a body that is not an object of settings', () => {
    expect(() => parseAuthoringSettings(undefined)).toThrow('the settings must be an object')
    expect(() => parseAuthoringSettings(null)).toThrow('the settings must be an object')
    expect(() => parseAuthoringSettings([])).toThrow('the settings must be an object')
    expect(() => parseAuthoringSettings('off')).toThrow('the settings must be an object')
    expect(() => parseAuthoringSettings({ other: 1 })).toThrow('unknown settings: other')
    expect(() => parseAuthoringSettings({ toolHiding: 'off', keepResultTurns: 1, other: 1 })).toThrow('unknown settings: other')
  })

  it('refuses a hiding that is not one of the three', () => {
    expect(() => parseAuthoringSettings({ toolHiding: 'sometimes' })).toThrow('toolHiding must be one of off, card, phase')
    expect(() => parseAuthoringSettings({ toolHiding: 2 })).toThrow('toolHiding must be one of off, card, phase')
  })

  it('refuses a count of turns that is not a whole number from zero to the most', () => {
    const refused = `keepResultTurns must be a whole number from 0 to ${MAX_KEEP_RESULT_TURNS}`
    expect(() => parseAuthoringSettings({ keepResultTurns: 1.5 })).toThrow(refused)
    expect(() => parseAuthoringSettings({ keepResultTurns: -1 })).toThrow(refused)
    expect(() => parseAuthoringSettings({ keepResultTurns: MAX_KEEP_RESULT_TURNS + 1 })).toThrow(refused)
    expect(() => parseAuthoringSettings({ keepResultTurns: '2' })).toThrow(refused)
    expect(() => parseAuthoringSettings({ keepResultTurns: null })).toThrow(refused)
  })
})
