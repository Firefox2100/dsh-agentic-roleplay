/** Each axis runs from -1 to 1. */
export interface EmotionVector {
  valence: number
  arousal: number
  dominance: number
}

export interface EmotionStart {
  /** Slow-moving temperament. */
  baseline: EmotionVector
  /** How the character feels right now; the baseline when not given. */
  immediate: EmotionVector
}
