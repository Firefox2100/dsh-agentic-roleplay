import type { Files, Language } from './language.ts'
import { loadData } from './framework/load.ts'

/** The id of the benchmark world in both languages: a story started from it can be told from the owner's own worlds. */
export const SALT_HARBOR_ID = { en: 'benchmark-salt-harbor-en', zh: 'benchmark-salt-harbor-zh' } as const

let loaded: ReturnType<typeof loadData> | undefined

/**
 * The anchor world of the benchmark: an invented harbour town that uses every part of the world format. Its files are data (`data/worlds/salt-harbor`); this reads them.
 * The same structure in both languages: only the words differ. A copy is returned, so a case may change it.
 */
export function saltHarbor(language: Language): Files {
  loaded ??= loadData()
  const files = loaded.worlds['salt-harbor']?.files[language]
  if (files === undefined) throw new Error(`the benchmark has no Salt Harbor in ${language}`)
  return new Map([...files].map(([path, value]) => [path, structuredClone(value)]))
}
