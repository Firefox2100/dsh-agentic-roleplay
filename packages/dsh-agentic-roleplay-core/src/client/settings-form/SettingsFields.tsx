import { Button, Input, SegmentedControl, Switch } from '@deepseek-ai/dsh-client-ui-primitives'
import { localized, type RequestOption } from '@dsh-ai-providers/core'
import css from './SettingsFields.module.css'
import { FAST_PRESET, FORM_FIELDS, boundsOf, keyOf, optionKey, problemsOf, type Drafts } from './fields.ts'
import type { SettingsFormKey } from './locales.ts'

/** The settings of a chat as editable fields: one control with its explanation under each. */
export function SettingsFields({ t, drafts, onChange, onPreset, options = [], disabled = false, locked = {}, hidden = [] }: {
  t: (key: SettingsFormKey, values?: Record<string, string | number>) => string
  drafts: Drafts
  onChange: (key: string, value: string | boolean) => void
  /** Sets several settings at once, as a preset does. */
  onPreset: (changes: Drafts) => void
  /** What the embedding provider lets a request set, to show after the settings. */
  options?: readonly RequestOption[]
  disabled?: boolean
  /** Choices that cannot be chosen now, by field and value, with why. */
  locked?: Readonly<Record<string, Readonly<Record<string, string>>>>
  /** Fields that something else on the page edits. */
  hidden?: readonly string[]
}) {
  const bad = problemsOf(drafts, options)
  const locale = t('localeId')
  return (
    <>
      <div className={css.row} data-testid="settings-presets">
        <div className={css.field}>
          <span className={css.label}>{t('presetFast')}</span>
          <Button variant="outline" size="sm" disabled={disabled} onClick={() => { onPreset(FAST_PRESET) }}>{t('presetApply')}</Button>
        </div>
        <p className={css.help}>{t('presetFastHelp')}</p>
      </div>
      {FORM_FIELDS.filter(field => !hidden.includes(keyOf(field))).map((field) => {
        const key = keyOf(field)
        const { min, max } = field.kind === 'choice' || field.kind === 'text' ? { min: 0, max: 0 } : boundsOf(field)
        return (
          <div key={key} className={css.row}>
            <label className={css.field}>
              <span className={css.label}>{t(field.label)}</span>
              {field.kind === 'flag'
                ? <Switch checked={drafts[key] === true} label={t(field.label)} disabled={disabled} onChange={(next) => { onChange(key, next) }} />
                : field.kind === 'choice'
                  ? (
                      <SegmentedControl
                        id={`rp-${key}`}
                        label={t(field.label)}
                        value={String(drafts[key] ?? field.choices[0].value)}
                        options={field.choices.map((choice) => { const why = locked[key]?.[choice.value]; return { value: choice.value, label: t(choice.label), ...(why === undefined ? {} : { disabled: true, title: why }) } })}
                        disabled={disabled}
                        onChange={(next) => { onChange(key, next) }}
                      />
                    )
                  : field.kind === 'text'
                    ? 'rows' in field
                      ? (
                          <textarea
                            className={css.area}
                            rows={field.rows}
                            value={String(drafts[key] ?? '')}
                            disabled={disabled}
                            onChange={(event) => { onChange(key, event.target.value) }}
                          />
                        )
                      : (
                        <Input
                          type="text"
                          value={String(drafts[key] ?? '')}
                          placeholder={field.placeholder}
                          disabled={disabled}
                          aria-invalid={bad.has(key)}
                          onChange={(event) => { onChange(key, event.target.value) }}
                        />
                      )
                    : (
                    <Input
                      type="number"
                      min={min}
                      max={max}
                      step={field.kind === 'decimal' ? 0.05 : 1}
                      value={String(drafts[key] ?? '')}
                      disabled={disabled}
                      aria-invalid={bad.has(key)}
                      onChange={(event) => { onChange(key, event.target.value) }}
                    />
                  )}
            </label>
            <p className={css.help}>{t(field.help)}</p>
            {bad.has(key) && <p className={css.error}>{field.kind === 'text' ? t('invalidZone') : t('invalid', { min, max })}</p>}
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
