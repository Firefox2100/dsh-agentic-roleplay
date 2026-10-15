export const REFLECTION_REASONS = ['turns', 'scene', 'manual'] as const
export type ReflectionReason = (typeof REFLECTION_REASONS)[number]

/** What one reflection did for one character. */
export type ReflectionOutcome = {
  name: string
  added: number
  revised: number
  dropped: number
}

/** The state of a story's reflection, as the settings tab shows it. */
export interface ReflectionStatus {
  /** Whether a pass is running now. */
  running: boolean
  /** The latest pass that finished. */
  last?: { turn: number; at: string; reason: ReflectionReason; characters: ReflectionOutcome[] }
  /** Why the latest pass failed, until the next one succeeds. */
  error?: { at: string; message: string }
}
