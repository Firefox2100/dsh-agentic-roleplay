export type CheckpointReason = 'turn' | 'manual' | 'before-restore'

/** A copy of a world's files, made before an authoring turn edits it, on the person's request, or before a restore. */
export interface CheckpointInfo {
  id: string
  at: string
  label: string
  reason: CheckpointReason
  /** The authoring chat and turn whose first edit it was taken for. */
  chat?: string
  turn?: number
  files: number
  bytes: number
}

export interface CheckpointDiff {
  /** Files that differ from the checkpoint. */
  changed: string[]
  /** Files the world has now and the checkpoint did not. */
  added: string[]
  /** Files the checkpoint has and the world no longer does. */
  removed: string[]
}
