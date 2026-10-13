import type { VectorStatus } from '../../shared/vectors.ts'

interface VectorSession {
  recallIndex: {
    readonly vectors: { available: boolean }
    info(): { model: string; dimensions: number; embedded: number; pending: number } | undefined
    pending(limit: number): unknown[]
    reset(): void
  }
}

/** How many waiting texts are counted before saying "that many": the number is for reassurance, not accounting. */
const MAX_COUNTED = 10_000

export function vectorStatus(session: VectorSession): VectorStatus {
  const info = session.recallIndex.info()
  return { available: session.recallIndex.vectors.available, ...(info === undefined ? { embedded: 0, pending: session.recallIndex.pending(MAX_COUNTED).length } : { model: info.model, dimensions: info.dimensions, embedded: info.embedded, pending: info.pending }) }
}

/** Forgets the stored vectors; the texts stay and are embedded again, by the model now selected, the next time the story searches. */
export function resetVectors(session: VectorSession): void {
  session.recallIndex.reset()
}
