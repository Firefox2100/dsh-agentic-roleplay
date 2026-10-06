import { describe, expect, it } from 'vitest'
import { decodeOutput, encodeOutput } from '../../src/shared/narration.ts'
import { parseOoc } from '../../src/shared/ooc.ts'
import { rulesOf } from '../../src/shared/rules.ts'
import { DEFAULT_SETTINGS, parseSettings } from '../../src/shared/settings.ts'

describe('an out-of-character command', () => {
  it('is a message that begins with /ooc, whatever the case or the space before it, and it is the whole turn', () => {
    expect(parseOoc('/ooc Claire goes backstage')).toEqual({ request: 'Claire goes backstage' })
    expect(parseOoc('  /OOC   spawn a key\nunder the table ')).toEqual({ request: 'spawn a key\nunder the table' })
    expect(parseOoc('/ooc')).toEqual({ request: '' })
  })

  it('is not something that only looks like one', () => {
    expect(parseOoc('I say /ooc to Claire')).toBeUndefined()
    expect(parseOoc('/oocx something')).toBeUndefined()
    expect(parseOoc('/oo c')).toBeUndefined()
    expect(parseOoc('')).toBeUndefined()
  })

  it('travels with the output, whole or not at all', () => {
    const output = { segments: [], repaired: false, ooc: { legal: false, note: 'No magic here.' } }
    expect(decodeOutput(encodeOutput(output))).toEqual(output)
    expect(decodeOutput('<roleplay-output>{"segments":[],"repaired":false,"ooc":{"legal":"yes","note":1}}</roleplay-output>')).toEqual({ segments: [], repaired: false })
  })
})

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
