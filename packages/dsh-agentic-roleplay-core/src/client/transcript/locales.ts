import type { Dictionaries } from '../i18n.ts'

export type TranscriptLocaleKey = 'repaired' | 'suggestions' | 'suggestionHint'

export const dictionaries: Dictionaries<TranscriptLocaleKey> = {
  en: { repaired: 'Corrected so that every spoken line is exactly what the character said.', suggestions: 'You could', suggestionHint: 'Put it in the input box' },
  zh: { repaired: '已修正，确保每句台词与角色原话一致。', suggestions: '你可以', suggestionHint: '填入输入框' },
}
