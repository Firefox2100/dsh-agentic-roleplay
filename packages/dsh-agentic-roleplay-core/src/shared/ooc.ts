/** What the player writes to speak to the game master as the author of the story: a command (`/ooc`) or a question (`/ask`), a turn of its own, never mixed with an action of the character. */
const OOC_COMMAND = /^\s*\/(ooc|ask)(?=\s|$)\s*([\s\S]*)$/i

/** The command or question in a player's message, or nothing when the message is an ordinary action. The request may be empty. */
export function parseOoc(text: string): { request: string; question: boolean } | undefined {
  const match = OOC_COMMAND.exec(text)
  return match === null ? undefined : { request: (match[2] ?? '').trim(), question: match[1]!.toLowerCase() === 'ask' }
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
