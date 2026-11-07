import { Button, Input } from '@deepseek-ai/dsh-client-ui-primitives'
import { OFFLOAD_ROLES, type OffloadRole } from '../../shared/offload.ts'
import type { SettingsLocaleKey } from './locales.ts'
import { SERVED_ROLES, offloadDraftOf, offloadProblemOf, type OffloadDraft } from './offload.ts'
import css from './CatalogueSettings.module.css'

type Translate = (key: SettingsLocaleKey) => string

const ROLE_TEXT = {
  main: 'offloadRole_main', embedding: 'offloadRole_embedding', reranker: 'offloadRole_reranker', decision: 'offloadRole_decision', image: 'offloadRole_image', speech: 'offloadRole_speech',
} as const satisfies Record<OffloadRole, SettingsLocaleKey>

/**
 * Which models cannot stay loaded together. Each group is a set of roles of which only one is kept in memory: before one is used the others are
 * unloaded from the server. A role that is in a group also says where it is served.
 */
export function OffloadSettings({ t, text, disabled, onEdit }: { t: Translate; text: string; disabled: boolean; onEdit: (text: string) => void }) {
  const draft = offloadDraftOf(text)
  const write = (next: OffloadDraft): void => { onEdit(JSON.stringify(next)) }
  const problem = offloadProblemOf(draft)
  const grouped = new Set(draft.groups.flat())
  const toggle = (index: number, role: OffloadRole, on: boolean): void => {
    write({ ...draft, groups: draft.groups.map((group, at) => (at !== index ? group : OFFLOAD_ROLES.filter(member => (member === role ? on : group.includes(member))))) })
  }
  const place = (role: (typeof SERVED_ROLES)[number], patch: Partial<{ route: string; model: string }>): void => {
    write({ ...draft, models: { ...draft.models, [role]: { route: '', model: '', ...draft.models[role], ...patch } } })
  }
  return (
    <section className={css.section} data-testid="roleplay-offload-settings">
      <h3 className={css.title}>{t('offload')}</h3>
      <p className={css.hint}>{t('offloadHint')}</p>
      {draft.groups.map((group, index) => (
        <div className={css.row} key={index} data-testid="offload-group">
          <div className={css.field} style={{ gridColumn: '1 / -1', flexDirection: 'row', flexWrap: 'wrap', gap: 12 }}>
            {OFFLOAD_ROLES.map(role => (
              <label key={role} className={css.keyHint} style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                <input type="checkbox" checked={group.includes(role)} disabled={disabled} data-role={role} onChange={(event) => { toggle(index, role, event.target.checked) }} />
                <span>{t(ROLE_TEXT[role])}</span>
              </label>
            ))}
            <Button variant="ghost" size="sm" disabled={disabled} onClick={() => { write({ ...draft, groups: draft.groups.filter((_, at) => at !== index) }) }}>{t('offloadRemove')}</Button>
          </div>
        </div>
      ))}
      <div className={css.actions}>
        <Button variant="outline" size="sm" disabled={disabled} onClick={() => { write({ ...draft, groups: [...draft.groups, []] }) }}>{t('offloadAdd')}</Button>
      </div>
      {SERVED_ROLES.filter(role => grouped.has(role)).map(role => (
        <div className={css.row} key={role} data-testid={`offload-model-${role}`}>
          <label className={css.field}><span className={css.label}>{t(ROLE_TEXT[role])}: {t('offloadRoute')}</span><Input value={draft.models[role]?.route ?? ''} disabled={disabled} onChange={(event) => { place(role, { route: event.target.value }) }} /></label>
          <label className={css.field}><span className={css.label}>{t('offloadModel')}</span><Input value={draft.models[role]?.model ?? ''} disabled={disabled} onChange={(event) => { place(role, { model: event.target.value }) }} /></label>
        </div>
      ))}
      {problem !== undefined && <p className={css.problem} role="alert">{t(problem.missing === 'route' ? 'offloadProblemRoute' : 'offloadProblemModel')} ({t(ROLE_TEXT[problem.role])})</p>}
    </section>
  )
}
