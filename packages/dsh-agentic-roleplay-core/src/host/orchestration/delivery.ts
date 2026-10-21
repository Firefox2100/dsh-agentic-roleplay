import type { NarrationChecker } from './boundaries.ts'
import type { NarrationSegment, TurnOutput } from './protocol.ts'
import { asSpoken } from './turn-text.ts'
import type { TurnState } from './turn-state.ts'
import { wrongLanguage } from '../translate/language.ts'

/** The game master is asked to correct its output this many times before it is corrected for it. */
export const MAX_REFUSALS = 2

/**
 * The output the game master delivered, once it is acceptable: every utterance exactly once and in order, and the narration in the chat's language.
 * A refusal is thrown for the game master to correct; past `MAX_REFUSALS`, or when `silent`, the output is repaired instead.
 */
export function checkedOutput(narrationChecker: NarrationChecker, language: string, state: TurnState, segments: readonly NarrationSegment[], silent: boolean): TurnOutput {
  const problems = [
    ...segments.flatMap((segment, index) => (segment.type === 'utterance' && segment.character === '' ? [`segment ${index + 1}: an utterance needs the character who says it`] : [])),
    ...narrationChecker.check(segments, state.utterances),
  ]
  const wording = wrongLanguage(language, { narration: segments.flatMap(segment => (segment.type === 'narration' ? [segment.text] : [])).join(' ') }, { strays: true })
  if (problems.length === 0 && wording !== undefined && !silent && state.refused < MAX_REFUSALS) {
    state.refused += 1
    throw new Error(`the output is not acceptable: ${wording}. Deliver it again with the narration corrected; utterances may not be touched`)
  }
  if (problems.length === 0) return { segments: asSpoken(segments, state.utterances), repaired: false }
  state.refused += 1
  if (!silent && state.refused <= MAX_REFUSALS) {
    throw new Error(`the output is not acceptable: ${problems.join('; ')}. Deliver it again with these corrected; narration may be written freely, utterances may not be touched`)
  }
  return { segments: narrationChecker.repair(segments.filter(segment => segment.type !== 'utterance' || segment.character !== ''), state.utterances), repaired: true }
}
