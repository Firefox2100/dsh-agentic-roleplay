const STOP = new Set(['the', 'and', 'for', 'with', 'from', 'that', 'this', 'his', 'her', 'their', 'she', 'he', 'they', 'you', 'your', 'but', 'not', 'when', 'where', 'what', 'who', 'one', 'two', 'its', 'has', 'had', 'was', 'were', 'are', 'there', 'then', 'now', 'at', 'in', 'on', 'of', 'to', 'a', 'an'])

const MAX_TERMS = 40
const MIN_USES = 3

const capitalised = (word: string): boolean => /^\p{Lu}[\p{L}'’-]{2,}$/u.test(word) && !STOP.has(word.toLowerCase())

/** The parts of a name written "Place - Room": each part is a name of its own, and so is the whole. */
export function partsOfName(name: string): string[] {
  const parts: string[] = []
  let start = 0
  for (let at = 1; at < name.length - 1; at += 1) {
    if (!'-–—'.includes(name[at]!) || !/\s/u.test(name[at - 1]!) || !/\s/u.test(name[at + 1]!)) continue
    const part = name.slice(start, at).trim()
    if (part !== '') parts.push(part)
    start = at + 1
  }
  const last = name.slice(start).trim()
  if (last !== '') parts.push(last)
  return parts
}

/**
 * Words of the world that recur inside other names and texts and so have to be rendered once: the parts of names ("Iron Stag Inn" in "Iron Stag Inn - Bar") and capitalised
 * phrases of two or three words that the texts use again and again ("Iron Stag"). The most used come first; names are not repeated here.
 */
export function recurringTerms(names: readonly string[], texts: readonly string[]): string[] {
  const known = new Set(names)
  const found = new Map<string, number>()
  const add = (term: string, uses: number): void => { if (!known.has(term)) found.set(term, (found.get(term) ?? 0) + uses) }
  for (const name of names) for (const part of partsOfName(name)) if (part !== name) add(part, MIN_USES)
  const counts = new Map<string, number>()
  for (const text of [...names, ...texts]) {
    const words = text.split(/[^\p{L}'’-]+/u)
    for (let at = 0; at < words.length; at += 1) {
      for (const size of [2, 3]) {
        const phrase = words.slice(at, at + size)
        if (phrase.length !== size || !phrase.every(word => capitalised(word.replace(/['’]s$/, '')))) continue
        const key = phrase.join(' ').replace(/['’]s$/, '')
        counts.set(key, (counts.get(key) ?? 0) + 1)
      }
    }
  }
  for (const [phrase, uses] of counts) if (uses >= MIN_USES) add(phrase, uses)
  return [...found].sort((a, b) => b[1] - a[1]).slice(0, MAX_TERMS).map(([term]) => term)
}

/** Whether `text` uses `term` as a word of its own (case as written). */
export function usesTerm(text: string, term: string): boolean {
  const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`(?<![\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}])`, 'u').test(text)
}
