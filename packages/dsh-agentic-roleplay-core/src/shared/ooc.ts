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
