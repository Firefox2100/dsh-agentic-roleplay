/** What a session's search by meaning stands on. */
export interface VectorStatus {
  /** Whether this installation can store vectors at all. */
  available: boolean
  /** The model and size of the stored vectors; absent while there are none. */
  model?: string
  dimensions?: number
  /** Texts that have a vector, and texts still waiting for one. */
  embedded: number
  pending: number
}
