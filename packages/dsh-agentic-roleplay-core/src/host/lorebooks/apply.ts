import type { LoreDefinition } from 'dsh-roleplay-model'
import { loadLorebook } from './lorebooks.ts'

/** Which lorebooks a story was started with: kept in the story's own metadata, because the library may change afterwards. */
export const LOREBOOKS_KEY = 'roleplay.lorebooks'

export interface BookLore {
  /** The entries of every book, ready to be copied into the story. */
  definitions: LoreDefinition[]
  applied: { name: string; entries: number }[]
  /** What the person should be told: names an entry gives that no character answers to, and books that could not be used. */
  notes: string[]
}

/** The id an entry has in a story, so that books and the world's own lore never clash. */
export const bookEntryId = (book: string, id: string): string => `${book}:${id}`

/**
 * The entries of the named books as a story takes them. A book that cannot be used is refused when the person chose it and told about when only the world suggested it,
 * because the world may come from someone whose library differs. Characters an entry names that this story does not have are left out, and it is told.
 * @throws {Error} when a chosen book cannot be used.
 */
export async function lorebookLore(root: string, names: readonly string[], chosen: boolean, knows: (reference: string) => boolean, taken: ReadonlySet<string>): Promise<BookLore> {
  const result: BookLore = { definitions: [], applied: [], notes: [] }
  const used = new Set(taken)
  for (const name of [...new Set(names)]) {
    let book
    try {
      book = await loadLorebook(root, name)
      if (book.summary.problems.length > 0) throw new Error(`it has problems: ${book.summary.problems.join('; ')}`)
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error)
      if (chosen) throw new Error(`the lorebook "${name}" cannot be used: ${reason}`)
      result.notes.push(`The world suggests the lorebook "${name}", which cannot be used here (${reason}), so the story starts without it.`)
      continue
    }
    for (const entry of book.entries) {
      const id = bookEntryId(name, entry.id)
      if (used.has(id)) throw new Error(`the lorebook "${name}" has the entry "${entry.id}", whose id the story already has`)
      used.add(id)
      const knownBy = entry.scope === 'listed' ? entry.knownBy.filter(knows) : []
      for (const reference of entry.scope === 'listed' ? entry.knownBy : []) if (!knownBy.includes(reference)) result.notes.push(`The lorebook "${name}" says "${entry.title}" is known to "${reference}", who is not in this story.`)
      result.definitions.push({ ...entry, id, knownBy, related: entry.related.map(other => bookEntryId(name, other)) })
    }
    result.applied.push({ name, entries: book.entries.length })
  }
  return result
}
