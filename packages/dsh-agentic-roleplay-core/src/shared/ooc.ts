/** What the player writes to give the game master an out-of-character command: a turn of its own, never mixed with an action of the character. */
const OOC_COMMAND = /^\s*\/ooc(?=\s|$)\s*([\s\S]*)$/i

/** The command in a player's message, or nothing when the message is an ordinary action. The command may be empty. */
export function parseOoc(text: string): { request: string } | undefined {
  const match = OOC_COMMAND.exec(text)
  return match === null ? undefined : { request: (match[1] ?? '').trim() }
}

/** How an out-of-character command was ruled on, and the plain words to the player that go with it. */
export interface OocRuling {
  legal: boolean
  note: string
}

/** The longest ruling note: it is shown to the player beside the story. */
export const MAX_OOC_NOTE = 400
