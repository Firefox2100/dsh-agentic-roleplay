import type { EmotionStart } from './emotion.ts'
import type { Intent } from './intent.ts'

/**
 * Where a character stands when the story begins, as if loaded from a save
 * made just after the story started.
 */
export interface CharacterStart {
  /** What anyone present can see or work out. */
  publicState: string
  /** What the character thinks and feels; nobody else can see it. */
  innerState: string
  /** What the character is concretely doing, which may differ from how it looks. */
  activity: string
  emotion?: EmotionStart
  intents: Intent[]
}
