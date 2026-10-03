import type { BuiltInLocaleId } from '@deepseek-ai/dsh-client-locale/client'

/**
 * A feature's copy for every locale the web UI ships. Typing it as a full
 * record makes a missing translation a compile error.
 */
export type Dictionaries<Key extends string> = Record<BuiltInLocaleId, Record<Key, string>>

/** A feature's copy together with the copy of a shared piece it embeds. */
export function withDictionaries<Own extends string, Shared extends string>(own: Dictionaries<Own>, shared: Dictionaries<Shared>): Dictionaries<Own | Shared> {
  return Object.fromEntries((Object.keys(own) as BuiltInLocaleId[]).map(locale => [locale, { ...own[locale], ...shared[locale] }])) as Dictionaries<Own | Shared>
}
