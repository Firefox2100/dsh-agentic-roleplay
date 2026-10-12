import type { SemanticRanker } from '@dsh-agentic-roleplay/state'

/** What the ranker needs of the reranking service another plugin supplies as `ctx.rerankers`. */
export interface Reranker {
  rerank(query: string, documents: readonly string[], options?: { signal?: AbortSignal; topN?: number }): Promise<{ results: readonly { index: number; score: number }[] }>
}

/**
 * Judges the pool of memories a recall over-retrieved with a reranking service, by reading the
 * situation and each memory together. Without a service it has nothing to judge and says so, and the
 * recall goes by retrieval alone; a service that fails is reported once per kind of message and the
 * recall carries on the same way, so that a provider that is down costs the story nothing but accuracy.
 */
export function rerankMemories(deps: { reranker: () => Reranker | undefined; problem: (message: string) => void }): SemanticRanker {
  const reported = new Set<string>()
  return async ({ situation, candidates, signal }) => {
    const reranker = deps.reranker()
    const asked = candidates.filter(candidate => candidate.text.trim() !== '')
    if (reranker === undefined || asked.length === 0 || situation.trim() === '') return undefined
    try {
      const { results } = await reranker.rerank(situation, asked.map(candidate => candidate.text), { topN: asked.length, ...(signal === undefined ? {} : { signal }) })
      return new Map(results.flatMap(({ index, score }) => (asked[index] === undefined ? [] : [[asked[index].key, score] as const])))
    } catch (error) {
      if (signal?.aborted === true) throw error
      const message = `rerank: ${error instanceof Error ? error.message : String(error)}: recall goes by retrieval alone`
      if (!reported.has(message)) {
        reported.add(message)
        deps.problem(message)
      }
      return undefined
    }
  }
}
