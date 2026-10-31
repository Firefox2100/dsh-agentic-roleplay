const HAN = /[㐀-鿿]+/gu
/** Words of fewer letters are mostly the glue of a language, which says nothing about whether two texts share facts. */
const MIN_LETTERS = 4

/** The comparable terms of a text: Latin words of four letters or more, other scripts' words of two, and the pairs of neighbouring Han characters (Chinese has no spaces). */
export function termsOf(text: string): Set<string> {
  const found = new Set<string>()
  const lower = text.normalize('NFKC').toLowerCase()
  for (const [run] of lower.matchAll(HAN)) {
    if (run.length === 1) found.add(run)
    for (let at = 0; at + 1 < run.length; at++) found.add(run.slice(at, at + 2))
  }
  for (const [word] of lower.replace(HAN, ' ').matchAll(/[\p{L}\p{N}]+/gu)) {
    if (/^[a-z0-9]+$/u.test(word) ? word.length >= MIN_LETTERS : word.length >= 2) found.add(word)
  }
  return found
}

/** How much of `of` is found in `within`, from 0 to 1; a text with no terms counts as found. */
export function shareOf(of: ReadonlySet<string>, within: ReadonlySet<string>): number {
  if (of.size === 0) return 1
  let shared = 0
  for (const term of of) if (within.has(term)) shared += 1
  return shared / of.size
}

/** A text as names are looked up in it: width- and case-folded. */
export const folded = (text: string): string => text.normalize('NFKC').toLowerCase()

/** A text as a quote of it is looked up: folded, with runs of white space as one space. */
export const squashed = (text: string): string => folded(text).replace(/\s+/gu, ' ').trim()
