import { noAt, yesAt } from '../decisions/route.ts'
import type { ImportContext } from '../import/run.ts'

export interface Verdict {
  yes: boolean
  /** Which one gave it: the decision model when it was sure, else the language model. */
  by: 'decision' | 'language'
}

/**
 * A yes-or-no about one thing: the decision model answers when the import is set to use one and it is sure; when it is not sure, cannot be used, or none is set, `ask` puts the
 * question to the language model. The decision model is never the only reader of a thing that may be wrong.
 */
export async function verdictOf(model: ImportContext, state: Record<string, unknown>, key: string, instructions: string, ask: () => Promise<boolean>): Promise<Verdict> {
  if (model.decide !== undefined) {
    try {
      const probability = (await model.decide(state, [{ key, instructions }])).get(key)
      const confidence = model.confidence ?? 0.7
      if (probability !== undefined && probability >= yesAt(confidence)) return { yes: true, by: 'decision' }
      if (probability !== undefined && probability <= noAt(confidence)) return { yes: false, by: 'decision' }
    } catch (error) {
      if (model.cancelled?.() === true) throw error
    }
  }
  return { yes: await ask(), by: 'language' }
}

/** A decision model's no only rules a pair out when it is this sure: the language model that follows must quote both sides, so passing on a doubtful pair costs a request, and dropping it loses a finding. */
const RULED_OUT_CONFIDENCE = 0.95

/** Whether a pair is worth the language model's reading: everything except what the decision model is very sure is nothing. */
export async function worthReading(model: ImportContext, state: Record<string, unknown>, key: string, instructions: string): Promise<boolean> {
  if (model.decide === undefined) return true
  try {
    const probability = (await model.decide(state, [{ key, instructions }])).get(key)
    return probability === undefined || probability > noAt(RULED_OUT_CONFIDENCE)
  } catch (error) {
    if (model.cancelled?.() === true) throw error
    return true
  }
}
