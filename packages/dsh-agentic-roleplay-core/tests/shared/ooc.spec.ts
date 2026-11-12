import { describe, expect, it } from 'vitest'
import { decodeOutput, encodeOutput } from '../../src/shared/narration.ts'
import { rulesOf } from '../../src/shared/rules.ts'
import { DEFAULT_SETTINGS, parseSettings } from '../../src/shared/settings.ts'

describe('the rules of a story', () => {
  it('are the world\'s, then the player\'s own one per line, without blank lines', () => {
    expect(rulesOf(['There is no magic.'], '  No flying \n\n\nNo guns')).toEqual(['There is no magic.', 'No flying', 'No guns'])
    expect(rulesOf([], '')).toEqual([])
  })

  it('are a setting of free text, empty by default and bounded', () => {
    expect(DEFAULT_SETTINGS.rules.own).toBe('')
    expect(parseSettings({ rules: { own: 'No flying' } })).toMatchObject({ ok: true, value: { rules: { own: 'No flying' } } })
    expect(parseSettings({ rules: { own: 'x'.repeat(2001) } })).toMatchObject({ ok: false })
  })
})

describe('an out-of-character ruling', () => {
  it('travels with the output, whole or not at all, an answer too', () => {
    const answered = { segments: [], repaired: false, ooc: { legal: true, note: 'He is a stranger.', question: true as const } }
    expect(decodeOutput(encodeOutput(answered))).toEqual(answered)

    const output = { segments: [], repaired: false, ooc: { legal: false, note: 'No magic here.' } }
    expect(decodeOutput(encodeOutput(output))).toEqual(output)
    expect(decodeOutput('<roleplay-output>{"segments":[],"repaired":false,"ooc":{"legal":"yes","note":1}}</roleplay-output>')).toEqual({ segments: [], repaired: false })
  })
})
