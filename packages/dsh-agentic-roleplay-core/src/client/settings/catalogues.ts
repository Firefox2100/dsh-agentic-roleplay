import type { SettingsFieldSpec } from '@deepseek-ai/dsh-client-ui-primitives'
import { CREDENTIAL_REF, catalogueKeyRef } from '../../shared/catalogue.ts'

export interface CatalogueRow {
  name: string
  baseUrl: string
  /** The credential the key is stored under; empty means the one derived from the name. */
  apiKeyRef: string
  /** A key an earlier version wrote in the configuration; dropped when the settings are saved. */
  apiKey: string
}

/** The credential a row's key lives under, or nothing while the row has no name to derive it from. */
export const keyRefOf = (row: CatalogueRow): string | undefined => (row.apiKeyRef.trim() !== '' ? row.apiKeyRef.trim() : row.name.trim() === '' ? undefined : catalogueKeyRef(row.name))

export type RowProblem = 'name' | 'address' | 'duplicate' | 'keyName'

const rowOf = (value: unknown): CatalogueRow => {
  const row = (typeof value === 'object' && value !== null ? value : {}) as Record<string, unknown>
  return { name: typeof row['name'] === 'string' ? row['name'] : '', baseUrl: typeof row['baseUrl'] === 'string' ? row['baseUrl'] : '', apiKeyRef: typeof row['apiKeyRef'] === 'string' ? row['apiKeyRef'] : '', apiKey: typeof row['apiKey'] === 'string' ? row['apiKey'] : '' }
}

/** The rows a draft text holds; the draft is only ever written by this form. */
export function rowsOf(text: string): CatalogueRow[] {
  try {
    const parsed: unknown = JSON.parse(text === '' ? '[]' : text)
    return Array.isArray(parsed) ? parsed.map(rowOf) : []
  } catch { return [] }
}

function isWebAddress(text: string): boolean {
  try {
    const url = new URL(text.trim())
    return (url.protocol === 'http:' || url.protocol === 'https:') && url.username === '' && url.password === '' && url.search === '' && url.hash === ''
  } catch { return false }
}

/** What stops a row from being saved, if anything. */
export function rowProblem(rows: readonly CatalogueRow[], index: number): RowProblem | undefined {
  const row = rows[index]!
  const name = row.name.trim()
  if (name === '') return 'name'
  if (rows.findIndex(other => other.name.trim() === name) !== index) return 'duplicate'
  if (row.apiKeyRef.trim() !== '' && !CREDENTIAL_REF.test(row.apiKeyRef.trim())) return 'keyName'
  return isWebAddress(row.baseUrl) ? undefined : 'address'
}

/** The `catalogues` list of the plugin's configuration as a draft: its rows as JSON text; a list with a problem blocks the save. */
export const cataloguesField: SettingsFieldSpec = {
  field: 'catalogues',
  format: value => JSON.stringify(Array.isArray(value) ? value.map(rowOf) : []),
  parse: (text) => {
    const rows = rowsOf(text)
    if (rows.some((_, index) => rowProblem(rows, index) !== undefined)) return undefined
    return rows.length === 0 ? { kind: 'clear' } : { kind: 'set', value: rows.map(row => ({ name: row.name.trim(), baseUrl: row.baseUrl.trim(), apiKeyRef: row.apiKeyRef.trim(), ...(row.apiKey.trim() === '' ? {} : { apiKey: row.apiKey.trim() }) })) }
  },
}

/** The `authoringTools` setting as a draft: the board of which tools of other plugins each authoring assistant is given, as JSON text; only what is on is kept. */
export const authoringToolsField: SettingsFieldSpec = {
  field: 'authoringTools',
  format: value => JSON.stringify(typeof value === 'object' && value !== null ? value : {}),
  parse: (text) => {
    try {
      const board = JSON.parse(text === '' ? '{}' : text) as Record<string, Record<string, boolean>>
      return Object.keys(board).length === 0 ? { kind: 'clear' } : { kind: 'set', value: board }
    } catch { return undefined }
  },
}
