import { describe, expect, it } from 'vitest'
import { cataloguesField, keyRefOf, rowProblem, rowsOf } from '../../../src/client/settings/catalogues.ts'

const draft = (rows: unknown): string => JSON.stringify(rows)

describe('the catalogue rows of the settings', () => {
  it('read a row written by an earlier version without the key it held as text, which is no longer used', () => {
    const rows = rowsOf(draft([{ name: 'Home', baseUrl: 'http://localhost:9798', apiKey: 'old' }]))
    expect(rows).toEqual([{ name: 'Home', baseUrl: 'http://localhost:9798', apiKeyRef: '' }])
    expect(keyRefOf(rows[0]!)).toBe('ROLEPLAY_CATALOGUE_HOME_API_KEY')
  })

  it('name the credential the row gives, else the one made from its name, and none without either', () => {
    expect(keyRefOf({ name: 'Home', baseUrl: '', apiKeyRef: ' MY_KEY ' })).toBe('MY_KEY')
    expect(keyRefOf({ name: ' ', baseUrl: '', apiKeyRef: '' })).toBeUndefined()
  })

  it('refuse a key name that is not a credential name', () => {
    const rows = rowsOf(draft([{ name: 'Home', baseUrl: 'http://localhost:9798', apiKeyRef: '9 bad' }]))
    expect(rowProblem(rows, 0)).toBe('keyName')
    expect(cataloguesField.parse(draft(rows))).toBeUndefined()
  })

  it('are saved with the key name and no key text', () => {
    const saved = cataloguesField.parse(draft([{ name: 'Home', baseUrl: 'http://localhost:9798', apiKeyRef: 'MY_KEY', apiKey: 'old' }]))
    expect(saved).toEqual({ kind: 'set', value: [{ name: 'Home', baseUrl: 'http://localhost:9798', apiKeyRef: 'MY_KEY' }] })
  })
})
