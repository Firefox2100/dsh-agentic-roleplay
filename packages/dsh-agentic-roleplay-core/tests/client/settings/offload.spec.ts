import { describe, expect, it } from 'vitest'
import { offloadDraftOf, offloadField } from '../../../src/client/settings/offload.ts'

describe('the offload form field', () => {
  it('shows a stored value in its normal form', () => {
    expect(JSON.parse(offloadField.format({ models: { image: { route: 'r', model: 'm' } }, groups: [['main', 'image']] }))).toEqual({ models: { image: { route: 'r', model: 'm' } }, groups: [['main', 'image']] })
    expect(JSON.parse(offloadField.format(undefined))).toEqual({ models: {}, groups: [] })
  })

  it('keeps a half-made group while it is edited, and does not save it', () => {
    const text = JSON.stringify({ models: {}, groups: [['main']] })
    expect(offloadDraftOf(text).groups).toEqual([['main']])
    expect(offloadField.parse(text)).toEqual({ kind: 'clear' })
  })

  it('refuses a group whose served model has no place', () => {
    expect(offloadField.parse(JSON.stringify({ models: {}, groups: [['main', 'image']] }))).toBeUndefined()
    expect(offloadField.parse(JSON.stringify({ models: { image: { route: 'r', model: 'm' } }, groups: [['main', 'image']] }))).toEqual({ kind: 'set', value: { models: { image: { route: 'r', model: 'm' } }, groups: [['main', 'image']] } })
  })

  it('reads damaged text as nothing', () => {
    expect(offloadDraftOf('{')).toEqual({ models: {}, groups: [] })
  })
})
