/** Tokens the model service reported for answered requests: what was read fresh, what came from its cache, and what was written. */
export interface TokenCount {
  input: number
  cached: number
  output: number
  /** The input of requests whose service gave no cache figure at all (LocalAI does not), so a cache that hit cannot be told from one that missed. Absent in records written before it was kept. */
  unreported?: number
}

/** What one turn of the story used: the game master's own requests, and those of the helpers that worked for it (characters, record keeper, suggestions and the rest). */
export interface TurnUsage {
  turn: number
  master: TokenCount
  helpers: TokenCount
  /** How many helper runs there were. */
  runs: number
  /** How long the game master's turn took, from its start to its end, in milliseconds: what the player waited for. Absent in records written before it was kept. */
  masterMs?: number
}

export const NO_TOKENS: TokenCount = { input: 0, cached: 0, output: 0 }

export const addTokens = (a: TokenCount, b: TokenCount): TokenCount => {
  const unreported = (a.unreported ?? 0) + (b.unreported ?? 0)
  return { input: a.input + b.input, cached: a.cached + b.cached, output: a.output + b.output, ...unreported > 0 ? { unreported } : {} }
}

export const totalTokens = (count: TokenCount): number => count.input + count.cached + count.output
