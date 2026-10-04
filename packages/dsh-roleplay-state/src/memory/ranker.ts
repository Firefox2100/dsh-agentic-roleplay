import type { RecallCandidate } from './recall.ts'

/**
 * Judges the pool of memories a recall over-retrieved against the situation: a reranker (or an
 * embedding model compared on the fly) behind one function. It returns how well each candidate
 * matches the situation, from 0 to 1, by the candidate's key; a candidate left out counts as 0. It
 * returns nothing when it has no way to judge right now (no reranking service is configured), and the
 * recall then goes by retrieval alone. The plugin that owns such a capability registers it with
 * `roleplayState.rankMemories`.
 */
export type SemanticRanker = (input: {
  situation: string
  candidates: readonly RecallCandidate[]
  signal?: AbortSignal
}) => Promise<ReadonlyMap<string, number> | undefined>
