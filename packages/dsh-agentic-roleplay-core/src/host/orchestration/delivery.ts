import type { NarrationChecker } from './boundaries.ts'
import type { NarrationSegment, TurnOutput } from './protocol.ts'
import { asSpoken } from './turn-text.ts'
import type { TurnState } from './turn-state.ts'
import { wrongLanguage } from '../translate/language.ts'
import { splitPanels } from '../import/panels.ts'

/** The game master is asked to correct its output this many times before it is corrected for it. */
export const MAX_REFUSALS = 2

/**
 * The output the game master delivered, once it is acceptable: every utterance exactly once and in order, and the narration in the chat's language.
 * A refusal is thrown for the game master to correct; past `MAX_REFUSALS`, or when `silent`, the output is repaired instead.
 */
/** The narration of the output without the status bars and panels a game master wrote into it: the story shows its tracked values itself. Utterances are never touched. */
export function withoutPanels(segments: readonly NarrationSegment[]): { segments: NarrationSegment[]; found: boolean } {
  let found = false
  const kept = segments.flatMap((segment): NarrationSegment[] => {
    if (segment.type !== 'narration') return [segment]
    const { prose, panels } = splitPanels(segment.text, { alone: true })
    if (panels.length === 0) return [segment]
    found = true
    return prose === '' ? [] : [{ ...segment, text: prose }]
  })
  return { segments: kept, found }
}

export function checkedOutput(narrationChecker: NarrationChecker, language: string, state: TurnState, delivered: readonly NarrationSegment[], silent: boolean): TurnOutput {
  const cleaned = withoutPanels(delivered)
  if (cleaned.found && !silent && state.refused < MAX_REFUSALS) {
    state.refused += 1
    throw new Error('the output is not acceptable: the narration holds a status bar, panel or block of tags. The story shows its tracked values itself, so write only the story. Deliver it again without it; utterances may not be touched')
  }
  const segments = cleaned.segments
  const problems = [
    ...segments.flatMap((segment, index) => (segment.type === 'utterance' && segment.character === '' ? [`segment ${index + 1}: an utterance needs the character who says it`] : [])),
    ...narrationChecker.check(segments, state.utterances),
  ]
  const wording = wrongLanguage(language, { narration: segments.flatMap(segment => (segment.type === 'narration' ? [segment.text] : [])).join(' ') }, { strays: true })
  if (problems.length === 0 && wording !== undefined && !silent && state.refused < MAX_REFUSALS) {
    state.refused += 1
    throw new Error(`the output is not acceptable: ${wording}. Deliver it again with the narration corrected; utterances may not be touched`)
  }
  if (problems.length === 0) return { segments: asSpoken(segments, state.utterances), repaired: cleaned.found }
  state.refused += 1
  if (!silent && state.refused <= MAX_REFUSALS) {
    throw new Error(`the output is not acceptable: ${problems.join('; ')}. Deliver it again with these corrected; narration may be written freely, utterances may not be touched`)
  }
  return { segments: narrationChecker.repair(segments.filter(segment => segment.type !== 'utterance' || segment.character !== ''), state.utterances), repaired: true }
}
