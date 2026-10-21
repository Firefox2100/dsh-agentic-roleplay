import { Button, Input } from '@deepseek-ai/dsh-client-ui-primitives'
import { CatalogueKey } from './CatalogueKey.tsx'
import { rowProblem, rowsOf, type CatalogueRow } from './catalogues.ts'
import type { SettingsLocaleKey } from './locales.ts'
import css from './CatalogueSettings.module.css'

type Translate = (key: SettingsLocaleKey) => string

const PROBLEM_TEXT = { name: 'catalogueProblemName', address: 'catalogueProblemAddress', duplicate: 'catalogueProblemDuplicate', keyName: 'catalogueProblemKeyName' } as const

/** The catalogues worlds can be installed from: a name, the API address and, optionally, a key for the private worlds. */
export function CatalogueSettings({ t, text, disabled, onEdit }: { t: Translate; text: string; disabled: boolean; onEdit: (text: string) => void }) {
  const rows = rowsOf(text)
  const change = (next: CatalogueRow[]): void => { onEdit(JSON.stringify(next)) }
  const set = (index: number, patch: Partial<CatalogueRow>): void => { change(rows.map((row, at) => (at === index ? { ...row, ...patch } : row))) }
  return (
    <section className={css.section} data-testid="roleplay-catalogue-settings">
      <h3 className={css.title}>{t('catalogues')}</h3>
      <p className={css.hint}>{t('cataloguesHint')}</p>
      {rows.map((row, index) => {
        const problem = rowProblem(rows, index)
        return (
          // The rows have no identity of their own: they are positions in the list the person edits.
          <div key={index} className={css.row} data-testid="roleplay-catalogue-row">
            <label className={css.field}><span className={css.label}>{t('catalogueName')}</span><Input value={row.name} disabled={disabled} onChange={(event) => { set(index, { name: event.target.value }) }} /></label>
            <label className={css.field}><span className={css.label}>{t('catalogueAddress')}</span><Input value={row.baseUrl} disabled={disabled} placeholder="https://catalogue.example/api" onChange={(event) => { set(index, { baseUrl: event.target.value }) }} /></label>
            <Button variant="ghost" size="sm" disabled={disabled} onClick={() => { change(rows.filter((_, at) => at !== index)) }}>{t('catalogueRemove')}</Button>
            <CatalogueKey t={t} row={row} disabled={disabled} onChange={(patch) => { set(index, patch) }} />
            <p className={css.keyHint}>{t('catalogueKeyHint')}</p>
            {problem !== undefined && <p className={css.problem} role="alert">{t(PROBLEM_TEXT[problem])}</p>}
          </div>
        )
      })}
      <div className={css.actions}>
        <Button variant="outline" size="sm" disabled={disabled} onClick={() => { change([...rows, { name: '', baseUrl: '', apiKeyRef: '', apiKey: '' }]) }}>{t('catalogueAdd')}</Button>
      </div>
    </section>
  )
}
