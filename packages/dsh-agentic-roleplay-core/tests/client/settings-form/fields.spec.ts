import { describe, expect, it } from 'vitest'
import { FORM_FIELDS, boundsOf, fromDrafts, keyOf, problemsOf, toDrafts } from '../../../src/client/settings-form/fields.ts'
import { DEFAULT_SETTINGS, parseSettings } from '../../../src/shared/settings.ts'

describe('the settings form', () => {
  it('starts from the settings, with a share shown as a percentage', () => {
    expect(toDrafts(DEFAULT_SETTINGS)).toEqual({ maxRounds: '3', 'memory.flaky': true, 'memory.recall': '12', 'memory.lookup': true, 'memory.verify': true, 'context.limitTokens': '24000', 'context.retainRatio': '50' })
  })

  it('gives back settings that parse, with what the form does not show left as it was', () => {
    const base = { ...DEFAULT_SETTINGS, context: { ...DEFAULT_SETTINGS.context, shortTermTokens: 999 } }
    const drafts = { ...toDrafts(base), maxRounds: '5', 'memory.flaky': false, 'context.retainRatio': '30' }
    const next = fromDrafts(base, drafts)
    expect(next).toMatchObject({ maxRounds: 5, memory: { flaky: false }, context: { retainRatio: 0.3, shortTermTokens: 999 } })
    expect(parseSettings(next).ok).toBe(true)
    expect(base.maxRounds).toBe(3)
  })

  it('finds the values that are out of bounds or not numbers', () => {
    const drafts = toDrafts(DEFAULT_SETTINGS)
    expect([...problemsOf(drafts)]).toEqual([])
    expect([...problemsOf({ ...drafts, maxRounds: '0', 'memory.recall': '2.5', 'context.limitTokens': '', 'context.retainRatio': '95' })].sort()).toEqual(['context.limitTokens', 'context.retainRatio', 'maxRounds', 'memory.recall'])
  })

  it('takes its bounds from the settings themselves', () => {
    const retain = FORM_FIELDS.find(field => keyOf(field) === 'context.retainRatio')!
    expect(boundsOf(retain)).toEqual({ min: 10, max: 90 })
    expect(boundsOf(FORM_FIELDS[0]!)).toEqual({ min: 1, max: 10 })
  })
})
