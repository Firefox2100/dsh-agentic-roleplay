export type Language = 'en' | 'zh'
export const LANGUAGES: readonly Language[] = ['en', 'zh']

/** Picks the text of a language; every text of the benchmark worlds is written in both. */
export const pick = (language: Language) => <T>(en: T, zh: T): T => (language === 'en' ? en : zh)

/** The files of a world by path under its folder: JSON values are written as JSON, strings as they are. */
export type Files = Map<string, unknown>
