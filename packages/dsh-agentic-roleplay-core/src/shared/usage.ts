/** Tokens the model service reported for answered requests: what was read fresh, what came from its cache, and what was written. */
export interface TokenCount {
  input: number
  cached: number
  output: number
}

/** What one turn of the story used: the game master's own requests, and those of the helpers that worked for it (characters, record keeper, suggestions and the rest). */
export interface TurnUsage {
  turn: number
  master: TokenCount
  helpers: TokenCount
  /** How many helper runs there were. */
  runs: number
}

export const NO_TOKENS: TokenCount = { input: 0, cached: 0, output: 0 }

export const addTokens = (a: TokenCount, b: TokenCount): TokenCount => ({ input: a.input + b.input, cached: a.cached + b.cached, output: a.output + b.output })

export const totalTokens = (count: TokenCount): number => count.input + count.cached + count.output
