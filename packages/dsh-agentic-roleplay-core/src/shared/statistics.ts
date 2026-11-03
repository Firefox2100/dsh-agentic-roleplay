/** How much one voice of the story spoke. */
export interface SpeakingShare {
  name: string
  lines: number
  /** Words, or characters for a script written without spaces. */
  length: number
}

/** The shape of a played story, counted from what is kept: nothing here is judged. */
export interface StoryStatistics {
  /** Turns on the way the story went. */
  turns: number
  realTime: {
    createdAt: string
    lastPlayedAt?: string
    /** Milliseconds the game master worked on the turns, from the usage record: what the player waited for. */
    waitedMs: number
  }
  storyTime: {
    start?: string
    now?: string
    /** Seconds of story time that passed since the start. */
    elapsedSeconds?: number
  }
  /** Stretches of the story in one place, by where its events happened. */
  scenes: number
  speaking: SpeakingShare[]
  narration: { passages: number; length: number }
  threads: { open: number; resolved: number }
  relationships: { total: number; changed: number }
  /** `branchPoints` turns were played more than once from the same state; `setAside` turns were played and are not on the way the story went. */
  branches: { branchPoints: number; setAside: number }
  usage: { runs: number; masterTokens: number; helperTokens: number }
}
