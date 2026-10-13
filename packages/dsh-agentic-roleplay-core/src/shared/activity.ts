/** One run of a helper agent, kept so that the player can see what the story's background work did and how long it took. */
export interface ActivityEntry {
  /** When the run ended, in milliseconds since 1970. */
  at: number
  /** Which helper, for example `Clara Whitlock` for a character, or `record keeper`. */
  label: string
  /** The model it ran on, as `provider/model`, or empty for the chat's own. */
  model: string
  /** How long it took. */
  ms: number
  /** How many tool calls it made. */
  calls: number
  /** Why it did not end with a result; absent when it did. */
  error?: string
}

/** The most runs a session keeps: the oldest are dropped. */
export const MAX_ACTIVITY = 60
