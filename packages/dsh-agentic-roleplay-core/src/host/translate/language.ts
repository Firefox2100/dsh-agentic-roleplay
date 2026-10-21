export type StoryLanguage = 'en' | 'zh'

export const STORY_LANGUAGES: readonly StoryLanguage[] = ['en', 'zh']

/** Less than this many letters of either script is too little to tell a language. */
const MIN_LETTERS = 20
/** A text is Chinese when this share of its Han and Latin letters is Han: names in the other script do not decide it. */
const HAN_SHARE = 0.3

const count = (text: string, pattern: RegExp): number => text.match(pattern)?.length ?? 0

/** The language a text is written in, by the script of its letters; nothing when there is too little text to tell. */
export function textLanguage(text: string): StoryLanguage | undefined {
  const han = count(text, /\p{Script=Han}/gu)
  const latin = count(text, /\p{Script=Latin}/gu)
  if (han + latin < MIN_LETTERS) return undefined
  return han / (han + latin) >= HAN_SHARE ? 'zh' : 'en'
}

export const isStoryLanguage = (value: unknown): value is StoryLanguage => value === 'en' || value === 'zh'

export const LANGUAGE_NAMES: Record<StoryLanguage, Record<StoryLanguage, string>> = {
  en: { en: 'English', zh: '英文' },
  zh: { en: 'Chinese', zh: '中文' },
}

const FOREIGN_WORD = /(?<![\p{L}\p{N}_-])\p{Ll}[\p{Ll}'’]{2,}(?![\p{L}\p{N}_-])/gu
const LATIN_WORD = /^\p{Script=Latin}+(?:['’]\p{Script=Latin}+)?$/u

/**
 * Ordinary English words left in a Chinese text. Names and acronyms keep their capitals and are left alone, so only lowercase words count;
 * the script test above cannot see them because Han letters outnumber them.
 */
export function strayWords(text: string): string[] {
  if (!/\p{Script=Han}/u.test(text)) return []
  return [...new Set((text.match(FOREIGN_WORD) ?? []).filter(word => LATIN_WORD.test(word)))]
}

/** What is wrong with texts that should be in the chat's language but are written in the other one; nothing when they are right, too short to tell, or the language is not one we can read. */
export function wrongLanguage(wanted: string, texts: Readonly<Record<string, string | undefined>>, options: { strays?: boolean } = {}): string | undefined {
  if (!isStoryLanguage(wanted)) return undefined
  const wrong = Object.entries(texts).flatMap(([name, text]) => {
    const found = text === undefined ? undefined : textLanguage(text)
    if (found !== undefined && found !== wanted) return [`${name} is written in ${LANGUAGE_NAMES[found].en}`]
    const strays = options.strays === true && wanted === 'zh' && text !== undefined ? strayWords(text).slice(0, 4) : []
    return strays.length === 0 ? [] : [`${name} leaves English words in (${strays.map(word => `"${word}"`).join(', ')})`]
  })
  return wrong.length === 0 ? undefined : `${wrong.join(' and ')}: write it in ${LANGUAGE_NAMES[wanted].en} (${LANGUAGE_NAMES[wanted][wanted]})`
}
