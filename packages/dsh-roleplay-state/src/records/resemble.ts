import { tokens } from '../memory/recall.ts'

const MIN_WORDS = 3
const JACCARD = 0.5
const OVERLAP = 0.75

/** Whether two sentences say nearly the same thing: most of the smaller one's words are in the other. */
export function resembles(a: string, b: string): boolean {
  const first = tokens(a)
  const second = tokens(b)
  const [small, large] = first.size <= second.size ? [first, second] : [second, first]
  if (small.size < MIN_WORDS) return false
  let shared = 0
  for (const word of small) if (large.has(word)) shared += 1
  return shared / small.size >= OVERLAP || shared / (first.size + second.size - shared) >= JACCARD
}
