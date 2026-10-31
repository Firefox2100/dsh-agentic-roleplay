/** A command typed in an authoring chat: `/name` and what follows it. */
export interface AuthoringCommand {
  name: string
  /** Everything after the name, trimmed. */
  rest: string
}

/** The command a message starts with, when its name is one of `names` (not a longer word that starts with it). */
export function parseAuthoringCommand(text: string, names: readonly string[]): AuthoringCommand | undefined {
  const value = text.trimStart()
  if (!value.startsWith('/')) return undefined
  const end = value.search(/\s/u)
  const word = (end < 0 ? value : value.slice(0, end)).slice(1).toLowerCase()
  return names.includes(word) ? { name: word, rest: end < 0 ? '' : value.slice(end).trim() } : undefined
}
