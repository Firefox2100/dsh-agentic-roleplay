import type { LorebookEntry } from '../../shared/lorebooks.ts'
import { partsOf, withPlayer } from '../import/items.ts'
import { readLorebook as readStLorebook } from '../import/lorebook.ts'
import { slug, uniqueKey } from '../import/run.ts'

/** Who the entries of a verbatim import are told to: everyone in the story, or only the game master (the safe choice, since nothing has read what the entries say). */
export type VerbatimKnownBy = 'everyone' | 'master'

const MAX_TITLE = 100

/**
 * The entries of a SillyTavern lorebook as they are, with no model between: each keeps its text word for word (an entry longer than a lore entry may be is cut at a paragraph, in order),
 * its keywords go into the summary, because here an entry is found by search, and none is given a kind or a place to be known beyond who may know it.
 * @throws {ImportCardError} when the file is not a lorebook or holds no entries that are switched on.
 */
export function verbatimEntries(file: Buffer, fileName: string, knownBy: VerbatimKnownBy): { name: string; entries: LorebookEntry[] } {
  const book = readStLorebook(file, fileName)
  const taken = new Set<string>()
  const entries: LorebookEntry[] = []
  for (const source of book.entries) {
    const title = (source.title || source.text.split('\n')[0]!.trim() || `Entry ${source.ref + 1}`).slice(0, MAX_TITLE)
    const parts = partsOf(withPlayer(source.text))
    for (const [index, body] of parts.entries()) {
      entries.push({
        id: uniqueKey(slug(title, 'entry'), taken), title: parts.length === 1 ? title : `${title.slice(0, MAX_TITLE - 6)} (${index + 1})`, kind: 'other', scope: knownBy === 'everyone' ? 'everyone' : 'listed', knownBy: [],
        summary: index === 0 && source.keys.length > 0 ? `Also: ${source.keys.join(', ')}.` : '', body, related: [],
      })
    }
  }
  return { name: book.name, entries }
}
