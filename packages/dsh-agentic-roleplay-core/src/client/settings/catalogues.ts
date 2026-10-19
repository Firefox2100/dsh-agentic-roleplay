import type { SettingsFieldSpec } from '@deepseek-ai/dsh-client-ui-primitives'

export interface CatalogueRow {
  name: string
  baseUrl: string
  apiKey: string
}

export type RowProblem = 'name' | 'address' | 'duplicate'

const rowOf = (value: unknown): CatalogueRow => {
  const row = (typeof value === 'object' && value !== null ? value : {}) as Record<string, unknown>
  return { name: typeof row['name'] === 'string' ? row['name'] : '', baseUrl: typeof row['baseUrl'] === 'string' ? row['baseUrl'] : '', apiKey: typeof row['apiKey'] === 'string' ? row['apiKey'] : '' }
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
  return isWebAddress(row.baseUrl) ? undefined : 'address'
}

/** The `catalogues` list of the plugin's configuration as a draft: its rows as JSON text; a list with a problem blocks the save. */
export const cataloguesField: SettingsFieldSpec = {
  field: 'catalogues',
  format: value => JSON.stringify(Array.isArray(value) ? value.map(rowOf) : []),
  parse: (text) => {
    const rows = rowsOf(text)
    if (rows.some((_, index) => rowProblem(rows, index) !== undefined)) return undefined
    return rows.length === 0 ? { kind: 'clear' } : { kind: 'set', value: rows.map(row => ({ name: row.name.trim(), baseUrl: row.baseUrl.trim(), apiKey: row.apiKey.trim() })) }
  },
}
