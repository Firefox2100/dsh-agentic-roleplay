import type { Session } from '@dsh-agentic-roleplay/state'
import { plotProgressOf } from '../pacing/director.ts'
import { plotReferenceProblems } from '../plots/load.ts'
import { populateLore } from '../sessions/populate.ts'
import { LOREBOOKS_KEY, bookEntryId, lorebookLore } from './apply.ts'

export type AppliedLorebook = { name: string; entries: number }

/** The lorebooks a story holds now. */
export function lorebooksOf(session: Session): AppliedLorebook[] {
  return (session.metadata.getValue(LOREBOOKS_KEY) as AppliedLorebook[] | undefined) ?? []
}

const keyOf = (entry: { sourceId?: string; id: number }): string => entry.sourceId ?? String(entry.id)

/**
 * Copies a library lorebook into a story that is already being played. The characters that know an entry learn it at the story's current turn.
 * @throws {Error} when the story already has the book or the book cannot be used.
 */
export async function addLorebook(root: string, session: Session, name: string): Promise<{ applied: AppliedLorebook; notes: string[] }> {
  const held = lorebooksOf(session)
  if (held.some(book => book.name === name)) throw new Error(`the story already has the lorebook "${name}"`)
  const taken = new Set(session.lore.list().flatMap(entry => entry.sourceId === undefined ? [] : [entry.sourceId]))
  const knows = (reference: string): boolean => session.characters.getBySourceId(reference) !== undefined || session.characters.findByName(reference).length > 0
  const book = await lorebookLore(root, [name], true, knows, taken)
  const applied = book.applied[0]!
  session.transaction(() => {
    populateLore(session, book.definitions, session.metadata.get().turns)
    session.metadata.setValue(LOREBOOKS_KEY, [...held, applied])
  })
  return { applied, notes: book.notes }
}

/**
 * Takes a lorebook's entries out of a story, together with what the characters learned from them. Entries the book gave are found by their id prefix.
 * @throws {Error} when the story does not have the book, or other lore or a plot still refers to one of its entries.
 */
export function removeLorebook(session: Session, name: string): number {
  const held = lorebooksOf(session)
  if (!held.some(book => book.name === name)) throw new Error(`the story does not have the lorebook "${name}"`)
  const all = session.lore.list()
  const leaving = all.filter(entry => entry.sourceId?.startsWith(bookEntryId(name, '')) === true)
  const ids = new Set(leaving.map(entry => entry.id))
  const citing = all.filter(entry => !ids.has(entry.id) && (entry.related.some(id => ids.has(id)) || entry.subjects.some(subject => subject.kind === 'lore' && ids.has(subject.id)))).map(entry => entry.title)
  if (citing.length > 0) throw new Error(`other lore refers to entries of this lorebook: ${citing.join(', ')}`)
  const remaining = all.filter(entry => !ids.has(entry.id)).map(keyOf)
  const plots = plotReferenceProblems(plotProgressOf(session.metadata).map(progress => progress.plot), [...session.characters.list().map(keyOf), ...session.factions.list().map(keyOf), ...session.locations.list().map(keyOf), ...session.items.list().map(keyOf), ...remaining])
  if (plots.length > 0) throw new Error(`a plot refers to entries of this lorebook: ${plots.join('; ')}`)
  session.transaction(() => {
    for (const entry of leaving) {
      for (const character of session.characters.list()) session.knowledge.forget(character.id, 'lore', entry.id)
      session.lore.remove(entry.id)
    }
    session.metadata.setValue(LOREBOOKS_KEY, held.filter(book => book.name !== name))
  })
  return leaving.length
}
