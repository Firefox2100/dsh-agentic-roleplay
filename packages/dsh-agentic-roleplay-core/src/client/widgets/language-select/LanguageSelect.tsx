import css from './LanguageSelect.module.css'

/** The languages offered for the prompts of an import or an assistant; the interface's own language is added when it is none of them. */
export const PROMPT_LANGUAGES = ['en', 'zh', 'ja', 'ko', 'es', 'fr', 'de', 'pt', 'ru', 'it'] as const

/** `zh-CN` and `ZH` are both `zh`. */
export const primaryLanguage = (tag: string): string => tag.trim().toLowerCase().split(/[-_]/)[0] ?? ''

/** A language by name, in the language given (the interface's); the tag itself when the browser does not know it. */
export function languageLabel(tag: string, inLanguage: string): string {
  try { return new Intl.DisplayNames([inLanguage], { type: 'language' }).of(tag) ?? tag } catch { return tag }
}

/** Chooses the language of prompts and assistants. `interfaceLanguage` names the language the names are shown in and is always among the choices. */
export function LanguageSelect({ value, onChange, interfaceLanguage, label, title, compact = false, disabled = false, testId }: {
  value: string
  onChange: (language: string) => void
  interfaceLanguage: string
  label: string
  /** The hover text, when the label alone does not explain it. */
  title?: string
  /** Sized to its content instead of the width of its container. */
  compact?: boolean
  disabled?: boolean
  testId?: string
}) {
  const choices = [...new Set([...PROMPT_LANGUAGES, primaryLanguage(interfaceLanguage), primaryLanguage(value)].filter(tag => tag !== ''))]
  return (
    <select className={compact ? `${css.select} ${css.compact}` : css.select} aria-label={label} {...(title === undefined ? {} : { title })} value={primaryLanguage(value)} disabled={disabled} {...(testId === undefined ? {} : { 'data-testid': testId })} onChange={(event) => { onChange(event.target.value) }}>
      {choices.map(tag => <option key={tag} value={tag}>{languageLabel(tag, interfaceLanguage)}</option>)}
    </select>
  )
}
