/** The command or question in a player's message, or nothing when the message is an ordinary action. The request may be empty. */
export function parseOoc(text: string): { request: string; question: boolean } | undefined {
  const value = text.trimStart()
  const boundary = value.search(/\s/u)
  const command = value.slice(0, boundary < 0 ? value.length : boundary).toLowerCase()
  if (command !== '/ooc' && command !== '/ask') return undefined
  return { request: value.slice(command.length).trim(), question: command === '/ask' }
}

/**
 * How an out-of-character command was ruled on, and the plain words to the player that go with it. A question is never refused:
 * its `note` is the answer and `question` says so.
 */
export interface OocRuling {
  legal: boolean
  note: string
  question?: true
}

/** The longest answer to an out-of-character question. */
export const MAX_OOC_ANSWER = 1200

/** The longest ruling note: it is shown to the player beside the story. */
export const MAX_OOC_NOTE = 400
