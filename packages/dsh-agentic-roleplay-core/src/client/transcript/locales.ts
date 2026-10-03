import type { Dictionaries } from '../i18n.ts'

export type TranscriptLocaleKey = 'repaired'

export const dictionaries: Dictionaries<TranscriptLocaleKey> = {
  en: { repaired: 'Corrected so that every spoken line is exactly what the character said.' },
  zh: { repaired: '已修正，确保每句台词与角色原话一致。' },
}
