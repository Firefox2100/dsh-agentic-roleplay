/**
 * What the words of a cue or a beat may name by `{kind:key}`, filled in from the story when they are told. The key is how the world's files
 * name the thing (`@self` in a cue is the character it is said to), and a name follows the story: a renamed character is renamed in the words.
 */
export const TEMPLATE_KINDS = {
  /** The name of a character. */
  character: { args: 1, about: 'a character' },
  /** The name of a place. */
  place: { args: 1, about: 'a place' },
  /** The name of an item. */
  item: { args: 1, about: 'an item' },
  /** The name of the place a character is in now. */
  where: { args: 1, about: 'a character' },
  /** Who holds an item now, or the place it lies in. */
  holder: { args: 1, about: 'an item' },
  /** What a variable is now, in words: `{value:key}` for a world variable, `{value:key:subject}` for the character, item or place it is about. */
  value: { args: 2, about: 'a variable' },
  /** The time of day in the story, as `19:30`. */
  time: { args: 0, about: '' },
} as const

export type TemplateKind = keyof typeof TEMPLATE_KINDS

export interface Placeholder {
  raw: string
  kind: TemplateKind
  args: string[]
}

const PATTERN = /\{([a-z]+)(?::([^{}]*))?\}/g

/** The placeholders in some words, and what is wrong with any that is not one. Anything that does not look like `{word}` or `{word:key}` is plain text. */
export function placeholdersOf(text: string): { found: Placeholder[]; problems: string[] } {
  const found: Placeholder[] = []
  const problems: string[] = []
  for (const match of text.matchAll(PATTERN)) {
    const [raw, word, rest] = match as unknown as [string, string, string | undefined]
    if (!(word in TEMPLATE_KINDS)) { problems.push(`${raw}: there is no "${word}"; the words may name ${Object.keys(TEMPLATE_KINDS).join(', ')}`); continue }
    const kind = word as TemplateKind
    const args = rest === undefined ? [] : rest.split(':').map(part => part.trim())
    const { args: wanted } = TEMPLATE_KINDS[kind]
    const ok = kind === 'value' ? args.length >= 1 && args.length <= 2 : args.length === wanted
    if (!ok || args.some(part => part === '')) { problems.push(`${raw}: ${kind === 'time' ? '{time} takes nothing' : kind === 'value' ? '{value:variable} or {value:variable:subject}' : `{${kind}:key} takes the key of ${TEMPLATE_KINDS[kind].about}`}`); continue }
    found.push({ raw, kind, args })
  }
  return { found, problems }
}
