/** Tokens a text of a number of characters comes to: a character of a script written without spaces takes about one and a half, of the others about a third. */
export function tokensOf(characters: number, language: string): number {
  return Math.ceil(language.toLowerCase().startsWith('zh') ? characters * 1.5 : characters / 3)
}

/** Tokens spent on the shape of a JSON answer (keys, quotes, braces), per field. */
export const FIELD_TOKENS = 8

/**
 * The most tokens to let a request produce, for an answer estimated at some tokens: the estimate with room to spare (`headroom` times it, rounded up to ten). The room is
 * for a model that thinks or says a little before it answers; what is far more than that is a model that does not stop, and is cut off instead of waited for.
 */
export function outputBudget(estimate: number, headroom: number): number {
  return Math.ceil(estimate * headroom / 10) * 10
}

/** The estimate of an answer made of texts that each have a declared limit in characters. */
export function estimateAnswer(limits: readonly number[], language: string): number {
  return limits.reduce((sum, limit) => sum + tokensOf(limit, language) + FIELD_TOKENS, 0)
}
