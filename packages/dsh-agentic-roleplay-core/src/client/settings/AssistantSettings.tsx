import { SettingsValueField, Tag, type SettingsFieldState } from '@deepseek-ai/dsh-client-ui-primitives'
import { ASSISTANT_FIELDS, type AssistantField } from './assistants.ts'
import type { SettingsLocaleKey } from './locales.ts'
import css from './AssistantSettings.module.css'

type Translate = (key: SettingsLocaleKey, values?: Record<string, string | number>) => string

function ChoiceField({ t, spec, state, disabled, onEdit, onReset }: {
  t: Translate
  spec: Extract<(typeof ASSISTANT_FIELDS)[number], { kind: 'choice' }>
  state: SettingsFieldState
  disabled: boolean
  onEdit: (text: string) => void
  onReset: () => void
}) {
  const id = `roleplay-${spec.field}`
  const messageId = `${id}-message`
  const known = (spec.choices as readonly string[]).includes(state.text)
  return (
    <div className={css.field}>
      <div className={css.head}>
        <label className={css.label} htmlFor={id}>{t(`${spec.field}Label`)}</label>
        {state.overridden && (
          <span className={css.badges}>
            <Tag tone="neutral">{t('overridden')}</Tag>
            <button type="button" className={css.reset} disabled={disabled} onClick={onReset}>{t('reset')}</button>
          </span>
        )}
      </div>
      <select id={id} className={css.select} value={state.text} disabled={disabled} aria-invalid={state.invalid || undefined} aria-describedby={messageId} onChange={(event) => { onEdit(event.target.value) }}>
        {!known && <option value={state.text}>{state.text}</option>}
        {spec.choices.map((choice, index) => <option key={choice} value={choice}>{t(spec.labels[index]!)}</option>)}
      </select>
      <p id={messageId} className={state.invalid ? css.invalid : css.fieldHint}>{state.invalid ? t('assistantInvalidChoice') : t(`${spec.field}Hint`)}</p>
    </div>
  )
}

/** How the helper agents of imports, translation and authoring are asked: how hard they think, on which model, how long they may work. */
export function AssistantSettings({ t, group, fields, disabled, onEdit, onReset }: { t: Translate; group: 'assistants' | 'limits'; fields: Record<AssistantField, SettingsFieldState>; disabled: boolean; onEdit: (field: AssistantField, text: string) => void; onReset: (field: AssistantField) => void }) {
  return (
    <section className={css.section} data-testid={`roleplay-${group}-settings`}>
      <h3 className={css.title}>{t(group)}</h3>
      <p className={css.hint}>{t(group === 'assistants' ? 'assistantsHint' : 'limitsHint')}</p>
      <div className={css.fields}>
        {ASSISTANT_FIELDS.filter(spec => spec.group === group).map(spec => spec.kind === 'choice'
          ? <ChoiceField key={spec.field} t={t} spec={spec} state={fields[spec.field]} disabled={disabled} onEdit={(text) => { onEdit(spec.field, text) }} onReset={() => { onReset(spec.field) }} />
          : (
              <SettingsValueField
                key={spec.field}
                id={`roleplay-${spec.field}`}
                label={t(`${spec.field}Label`)}
                hint={t(`${spec.field}Hint`)}
                placeholder={spec.placeholder}
                numeric={spec.kind === 'integer'}
                overriddenLabel={t('overridden')}
                resetLabel={t('reset')}
                invalidLabel={'min' in spec ? t('assistantInvalidRange', { min: spec.min, max: spec.max }) : t('invalid')}
                disabled={disabled}
                {...fields[spec.field]}
                onEdit={(text) => { onEdit(spec.field, text) }}
                onReset={() => { onReset(spec.field) }}
              />
            ))}
      </div>
    </section>
  )
}
