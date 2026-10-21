import { SAMPLING_KEYS, SAMPLING_RANGES, type StorySampling } from '../../../shared/sampling.ts'
import type { SamplingFieldsKey } from './locales.ts'
import css from './SamplingFields.module.css'

/** The text of each control as typed: empty when it is not set. */
export type SamplingTexts = Record<keyof StorySampling, string>

export const samplingTexts = (sampling: StorySampling): SamplingTexts => Object.fromEntries(SAMPLING_KEYS.map(key => [key, sampling[key]?.toString() ?? ''])) as SamplingTexts

/** The controls typed so far; a text that is not a number in range is left out, which the host then reports when the form is saved. */
export function samplingOfTexts(texts: SamplingTexts): StorySampling {
  const sampling: Record<string, number> = {}
  for (const key of SAMPLING_KEYS) {
    const text = texts[key].trim()
    if (text === '') continue
    sampling[key] = Number(text)
  }
  return sampling
}

/** Optional sampling controls of a preset or a world, one box each; a box left empty suggests nothing. */
export function SamplingFields({ texts, onChange, disabled, t }: { texts: SamplingTexts; onChange: (next: SamplingTexts) => void; disabled?: boolean; t: (key: SamplingFieldsKey) => string }) {
  return (
    <div className={css.root} data-testid="roleplay-sampling-fields">
      <div className={css.grid}>
        {SAMPLING_KEYS.map(key => (
          <label className={css.field} key={key}>
            <span className={css.label}>{t(`sf_${key}` as SamplingFieldsKey)}</span>
            <input className={css.input} value={texts[key]} disabled={disabled} inputMode="decimal" data-sampling={key} placeholder={SAMPLING_RANGES[key].neutral === undefined ? '' : String(SAMPLING_RANGES[key].neutral)} onChange={(event) => { onChange({ ...texts, [key]: event.target.value }) }} />
          </label>
        ))}
      </div>
      <p className={css.help}>{t('sf_help')}</p>
    </div>
  )
}
