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
  /** Names the stored detail of the run, when the session keeps it (setting `diagnostics.keepRuns`). */
  run?: string
}

/** One tool call of a helper: what it asked for and what came back. Long values are cut. */
export interface RunCall {
  tool: string
  args: string
  /** What the tool returned, or the reason it refused. */
  outcome: string
  failed: boolean
}

/** One thing a character was reminded of at the start of its run, and why it came back. */
export interface RunRecall {
  clarity: 'clear' | 'faded' | 'vague'
  turn: number
  text: string
  /** What brought it back; absent when the run did not ask for it. */
  why?: {
    cues: { people: number; words: number; place: number }
    lexical?: number
    dense?: number
    rerank?: number
    relevance: number
    importance: number
    ageDays: number
    retention?: number
    score: number
    /** Set for something that came to mind with another memory rather than from the moment: what it shares with it. */
    linked?: { people: number; tags: number; place: boolean }
  }
}

/** What a helper was told and did in one run, for finding out why it said or wrote what it did. */
export interface RunDetail {
  persona: string
  prompt: string
  /** What the character was reminded of before it decided, which is already in the prompt; here with the reasons. */
  recalled?: RunRecall[]
  calls: RunCall[]
  /** The result it submitted, as JSON, when it did. */
  result?: string
}

/** Longest text kept for one call's arguments or outcome, and for the persona, the prompt and the result. */
export const MAX_RUN_TEXT = 4000
export const MAX_RUN_PROMPT = 24_000
/** The most calls kept for one run: the first ones, which show what it was working from. */
export const MAX_RUN_CALLS = 60
/** The most reminders kept for one run. */
export const MAX_RUN_RECALLED = 30

/** The most runs a session keeps: the oldest are dropped. */
export const MAX_ACTIVITY = 60
