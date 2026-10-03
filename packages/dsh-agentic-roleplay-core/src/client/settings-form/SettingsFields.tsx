import { Input, Switch } from '@deepseek-ai/dsh-client-ui-primitives'
import { localized, type RequestOption } from 'dsh-ai-core'
import css from './SettingsFields.module.css'
import { FORM_FIELDS, boundsOf, keyOf, optionKey, problemsOf, type Drafts } from './fields.ts'
import type { SettingsFormKey } from './locales.ts'

/** The settings of a chat as editable fields: one control with its explanation under each. */
export function SettingsFields({ t, drafts, onChange, options = [], disabled = false }: {
  t: (key: SettingsFormKey, values?: Record<string, string | number>) => string
  drafts: Drafts
  onChange: (key: string, value: string | boolean) => void
  /** What the embedding provider lets a request set, to show after the settings. */
  options?: readonly RequestOption[]
  disabled?: boolean
}) {
  const bad = problemsOf(drafts, options)
  const locale = t('localeId')
  return (
    <>
      {FORM_FIELDS.map((field) => {
        const key = keyOf(field)
        const { min, max } = boundsOf(field)
        return (
          <div key={key} className={css.row}>
            <label className={css.field}>
              <span className={css.label}>{t(field.label)}</span>
              {field.kind === 'flag'
                ? <Switch checked={drafts[key] === true} label={t(field.label)} disabled={disabled} onChange={(next) => { onChange(key, next) }} />
                : (
                    <Input
                      type="number"
                      min={min}
                      max={max}
                      step={1}
                      value={String(drafts[key] ?? '')}
                      disabled={disabled}
                      aria-invalid={bad.has(key)}
                      onChange={(event) => { onChange(key, event.target.value) }}
                    />
                  )}
            </label>
            <p className={css.help}>{t(field.help)}</p>
            {bad.has(key) && <p className={css.error}>{t('invalid', { min, max })}</p>}
          </div>
        )
      })}
      {options.length > 0 && (
        <div className={css.group} data-testid="embedding-options">
          <h3 className={css.groupTitle}>{t('embeddingOptions')}</h3>
          <p className={css.help}>{t('embeddingOptionsHelp')}</p>
          {options.map((option) => {
            const key = optionKey(option)
            const label = localized(option.label, locale)
            return (
              <div key={key} className={css.row}>
                <label className={css.field}>
                  <span className={css.label}>{label}</span>
                  {option.type === 'boolean'
                    ? <Switch checked={drafts[key] === true} label={label} disabled={disabled} onChange={(next) => { onChange(key, next) }} />
                    : (
                        <Input
                          type={option.type === 'string' ? 'text' : 'number'}
                          {...(option.min === undefined ? {} : { min: option.min })}
                          {...(option.max === undefined ? {} : { max: option.max })}
                          step={option.type === 'integer' ? 1 : 'any'}
                          value={String(drafts[key] ?? '')}
                          placeholder={option.default === undefined ? '' : String(option.default)}
                          disabled={disabled}
                          aria-invalid={bad.has(key)}
                          onChange={(event) => { onChange(key, event.target.value) }}
                        />
                      )}
                </label>
                {option.description !== undefined && <p className={css.help}>{localized(option.description, locale)}</p>}
                {bad.has(key) && <p className={css.error}>{option.min !== undefined && option.max !== undefined ? t('invalid', { min: option.min, max: option.max }) : '!'}</p>}
              </div>
            )
          })}
        </div>
      )}
    </>
  )
}
