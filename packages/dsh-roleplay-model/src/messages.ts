import { ZH } from './messages-zh.ts'

/** The languages the texts a model reads are written in. English is the source: a text is its own key. */
export const LANGUAGES = ['en', 'zh'] as const
export type Language = (typeof LANGUAGES)[number]

/** The language a setting such as `zh-CN` or `en` stands for; English when it is none that is known. */
export function languageOf(code: string | undefined): Language {
  return (code ?? '').trim().toLowerCase().startsWith('zh') ? 'zh' : 'en'
}

export type MessageValues = Readonly<Record<string, string | number>>

/** Says a text in the language of the story: `tr('{name} is in {place}.', { name, place })`. */
export type Translate = (text: string, values?: MessageValues) => string

const fill = (template: string, values: MessageValues | undefined): string => (values === undefined ? template : template.replace(/\{(\w+)\}/g, (whole, name: string) => (name in values ? String(values[name]) : whole)))

const CATALOGUES: Readonly<Record<Exclude<Language, 'en'>, Readonly<Record<string, string>>>> = { zh: ZH }

/**
 * The texts the engine builds for a model (briefs, reports, refusals) in a language. The text written in the code is the English one and the key of
 * the others; a text a language lacks is told in English, and a test keeps that from happening.
 */
export function translator(language: Language): Translate {
  const catalogue = language === 'en' ? undefined : CATALOGUES[language]
  return (text, values) => fill(catalogue?.[text] ?? text, values)
}

/** The texts with a translation, for the test that every text has one. */
export const translated = (language: Exclude<Language, 'en'>): readonly string[] => Object.keys(CATALOGUES[language])
export const translation = (language: Exclude<Language, 'en'>, text: string): string | undefined => CATALOGUES[language][text]
