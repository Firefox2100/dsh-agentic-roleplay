import type { RecallCandidate } from './recall.ts'

/**
 * Ranks what a character could be reminded of by meaning, not only by cues: an embedding
 * model, a reranker, or both behind one function. It returns how well each candidate matches
 * the situation, from 0 to 1, by the candidate's key; a candidate left out counts as 0.
 * The plugin that owns such a capability registers it with `roleplayState.rankMemories`.
 */
export type SemanticRanker = (input: {
  situation: string
  candidates: readonly RecallCandidate[]
  signal?: AbortSignal
}) => Promise<ReadonlyMap<string, number>>
