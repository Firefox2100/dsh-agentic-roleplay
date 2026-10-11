import type { EmbeddingOptions } from '../../shared/settings.ts'

/** What the index needs of the embedding service another plugin supplies as `ctx.embeddings`. */
export interface Embedder {
  embed(texts: readonly string[], options?: Record<string, unknown>): Promise<{ vectors: number[][]; model: string; dimensions: number }>
}

/** The part of a chat's story the index reads and fills. */
export interface IndexedStory {
  recallIndex: {
    readonly vectors: { available: boolean }
    info(): { model: string; dimensions: number } | undefined
    pending(limit: number): { id: number; text: string }[]
    store(model: string, vectors: readonly { id: number; vector: readonly number[] }[]): number
  }
}

export interface EmbeddingIndexDeps {
  /** The embedding service, when a provider is selected and loaded. Looked up on each use. */
  embedder: () => Embedder | undefined
  story: (chat: string) => { story: IndexedStory; options: () => EmbeddingOptions } | undefined
  problem: (message: string) => void
  /** How many texts go to the provider in one call. */
  batch?: number
}

const BATCH = 32

/**
 * Keeps the vectors of a chat's texts: embeds what has none yet, and gives the vector of a moment to
 * search with. The story knows which texts wait and keeps the vectors; this is the only part that
 * talks to an embedding service. Everything degrades to searching by words: without a service, a
 * provider that fails, or vectors made by another model than the one now selected, the search
 * simply has no vector to use.
 */
export class EmbeddingIndex {
  private readonly running = new Map<string, Promise<void>>()
  private readonly reported = new Set<string>()

  constructor(private readonly deps: EmbeddingIndexDeps) {}

  /** Embed what is waiting, in the background; calls for one chat run one after another. */
  schedule(chat: string): void {
    const previous = this.running.get(chat) ?? Promise.resolve()
    const next = previous.then(() => this.fill(chat)).catch((error: unknown) => {
      this.complain(`indexing ${chat}`, error)
    })
    this.running.set(chat, next)
    void next.finally(() => { if (this.running.get(chat) === next) this.running.delete(chat) })
  }

  /** Wait for the indexing scheduled so far; for tests and orderly shutdown. */
  async idle(chat: string): Promise<void> {
    await this.running.get(chat)
  }

  /**
   * The vector of a text to search the chat's stored vectors with, or nothing when there is none to
   * compare with (no vectors yet, no service, or another model than the stored vectors').
   */
  async queryVector(chat: string, text: string, signal?: AbortSignal): Promise<readonly number[] | undefined> {
    const found = this.deps.story(chat)
    const embedder = this.deps.embedder()
    if (found === undefined || embedder === undefined || text.trim() === '') return undefined
    const { story, options } = found
    if (!story.recallIndex.vectors.available) return undefined
    if (story.recallIndex.pending(1).length > 0) this.schedule(chat)
    const info = story.recallIndex.info()
    if (info === undefined) return undefined
    try {
      const { vectors, model, dimensions } = await embedder.embed([text], { ...options(), inputType: 'query', ...(signal === undefined ? {} : { signal }) })
      const [vector] = vectors
      if (vector === undefined) return undefined
      if (model !== info.model || dimensions !== info.dimensions) {
        this.complain(`searching ${chat}`, new Error(`the stored vectors are from ${info.model} with ${info.dimensions} dimensions but the embedding provider now gives ${model} with ${dimensions}: the search goes by words until the vectors are made again`))
        return undefined
      }
      return vector
    } catch (error) {
      if (signal?.aborted === true) throw error
      this.complain(`searching ${chat}`, error)
      return undefined
    }
  }

  private async fill(chat: string): Promise<void> {
    const found = this.deps.story(chat)
    const embedder = this.deps.embedder()
    if (found === undefined || embedder === undefined || !found.story.recallIndex.vectors.available) return
    const batch = this.deps.batch ?? BATCH
    for (;;) {
      const waiting = found.story.recallIndex.pending(batch)
      if (waiting.length === 0) return
      const { vectors, model } = await embedder.embed(waiting.map(item => item.text), { ...found.options(), inputType: 'document', priority: 'background' })
      if (vectors.length !== waiting.length) throw new Error(`the embedding provider returned ${vectors.length} vectors for ${waiting.length} texts`)
      const stored = found.story.recallIndex.store(model, waiting.map((item, index) => ({ id: item.id, vector: vectors[index]! })))
      if (stored === 0) return
    }
  }

  /** Report a failure once per kind of message, so a provider that is down does not flood the log. */
  private complain(what: string, error: unknown): void {
    const message = `embeddings: ${what}: ${error instanceof Error ? error.message : String(error)}`
    if (this.reported.has(message)) return
    this.reported.add(message)
    this.deps.problem(message)
  }
}
