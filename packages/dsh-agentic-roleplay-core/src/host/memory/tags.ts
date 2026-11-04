const MIN_FUZZY_LENGTH = 5

const plain = (tag: string): string => tag.normalize('NFKC').trim().toLowerCase().replace(/[\s_]+/g, '-')

/** What two spellings of one word share: separators and a plural ending do not make a different tag. */
const stem = (tag: string): string => {
  const joined = plain(tag).replace(/-/g, '')
  return /^[a-z]{4,}s$/.test(joined) && !joined.endsWith('ss') ? joined.slice(0, -1) : joined
}

/** Whether two words differ by one letter (a substitution, an insertion or a deletion). */
function nearby(a: string, b: string): boolean {
  if (Math.abs(a.length - b.length) > 1 || a === b) return a === b
  const [short, long] = a.length <= b.length ? [a, b] : [b, a]
  let index = 0
  while (index < short.length && short[index] === long[index]) index += 1
  return short.length === long.length ? short.slice(index + 1) === long.slice(index + 1) : short.slice(index) === long.slice(index + 1)
}

/** How often each tag is used by the story's events, most used first: the vocabulary a new tag is chosen from. */
export function tagUsage(events: readonly { tags: readonly string[] }[]): Map<string, number> {
  const counts = new Map<string, number>()
  for (const event of events) for (const tag of new Set(event.tags.map(plain))) if (tag !== '') counts.set(tag, (counts.get(tag) ?? 0) + 1)
  return new Map([...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])))
}

/**
 * Brings new tags onto the tags already in use: the same word spelled differently (case,
 * separators, a plural, one letter off in a long word) becomes the existing tag, so recall, which
 * matches tags exactly, finds both. A tag that matches nothing stays: "none fits" is allowed.
 */
export function canonicalTags(known: ReadonlyMap<string, number>, tags: readonly string[]): string[] {
  const vocabulary = [...known.keys()]
  const canonical = tags.map(plain).filter(tag => tag !== '').map((tag) => {
    if (known.has(tag)) return tag
    const same = vocabulary.find(existing => stem(existing) === stem(tag))
    if (same !== undefined) return same
    if (!/^[a-z]+$/.test(tag) || tag.length < MIN_FUZZY_LENGTH) return tag
    return vocabulary.find(existing => /^[a-z]+$/.test(existing) && existing.length >= MIN_FUZZY_LENGTH && nearby(existing, tag)) ?? tag
  })
  return [...new Set(canonical)]
}

const phrase = (label: string): string => label.normalize('NFKC').trim().toLowerCase().replace(/\s+/g, ' ')

/** How often each relationship label is used by the story (spellings that differ only in case or spacing count together, under the most used one), most used first: the vocabulary a new label is chosen from. */
export function labelUsage(labels: readonly string[]): Map<string, number> {
  const groups = new Map<string, Map<string, number>>()
  for (const label of labels) {
    const key = phrase(label)
    if (key === '') continue
    const spellings = groups.get(key) ?? new Map<string, number>()
    spellings.set(label.trim(), (spellings.get(label.trim()) ?? 0) + 1)
    groups.set(key, spellings)
  }
  const counts = [...groups.values()].map((spellings): [string, number] => [[...spellings].sort((a, b) => b[1] - a[1])[0]![0], [...spellings.values()].reduce((sum, n) => sum + n, 0)])
  return new Map(counts.sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])))
}

/**
 * A relationship label spelled differently from one in use (case, spacing, a plural, one letter off in a long word)
 * becomes the existing spelling, so the story keeps one word for one kind of bond. A label that matches nothing stays: a new bond is allowed.
 */
export function canonicalLabel(known: ReadonlyMap<string, number>, label: string): string {
  const wanted = phrase(label)
  if (wanted === '') return label
  const vocabulary = [...known.keys()]
  return vocabulary.find(existing => phrase(existing) === wanted)
    ?? vocabulary.find(existing => stem(existing) === stem(wanted))
    ?? (/^[a-z]{5,}$/.test(wanted) ? vocabulary.find(existing => /^[a-z]{5,}$/.test(phrase(existing)) && nearby(phrase(existing), wanted)) : undefined)
    ?? label
}
