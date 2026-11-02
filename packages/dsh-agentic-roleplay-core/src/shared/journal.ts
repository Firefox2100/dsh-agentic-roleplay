/** The most a journal may hold. */
export const MAX_JOURNAL = 20000

/** The player's own notes on a story: nothing the story knows, only what the player wrote. */
export interface Journal {
  text: string
  /** When it was last written; absent for a journal never written. */
  updatedAt?: string
}
