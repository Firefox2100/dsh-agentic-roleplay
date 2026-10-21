/** What a preset or a world may say about how its story's model requests are asked; whatever is left out is the chat's own setting. */
export interface StorySampling {
  /** The temperature of the game master. */
  master?: number
  /** The temperature of the characters. */
  characters?: number
  topP?: number
  topK?: number
  minP?: number
  frequencyPenalty?: number
  presencePenalty?: number
  repetitionPenalty?: number
}

/** The controls beyond temperature, which apply to the game master and the characters (the helpers that must be exact are never asked more freely). */
export const SHARED_SAMPLING = ['topP', 'topK', 'minP', 'frequencyPenalty', 'presencePenalty', 'repetitionPenalty'] as const
export type SharedSamplingKey = typeof SHARED_SAMPLING[number]

/** Each control's range and the value that leaves the choice to the model's server (and so is never sent). */
export const SAMPLING_RANGES: Record<keyof StorySampling, { min: number; max: number; neutral?: number }> = {
  master: { min: 0, max: 2 },
  characters: { min: 0, max: 2 },
  topP: { min: 0, max: 1, neutral: 1 },
  topK: { min: 0, max: 1000, neutral: 0 },
  minP: { min: 0, max: 1, neutral: 0 },
  frequencyPenalty: { min: -2, max: 2, neutral: 0 },
  presencePenalty: { min: -2, max: 2, neutral: 0 },
  repetitionPenalty: { min: 0, max: 2, neutral: 1 },
}

export const SAMPLING_KEYS = Object.keys(SAMPLING_RANGES) as (keyof StorySampling)[]

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)

/** Reads the `sampling` object of a file or a request: every unknown name or out-of-range value is a problem, named with `where`. */
export function parseSampling(value: unknown, where: string, problems: string[]): StorySampling {
  const sampling: Record<string, number> = {}
  if (value === undefined || value === null) return sampling
  if (!isRecord(value)) { problems.push(`${where} must be an object`); return sampling }
  for (const key of Object.keys(value)) if (!Object.hasOwn(SAMPLING_RANGES, key)) problems.push(`${where}.${key} is not something that can be set (${SAMPLING_KEYS.join(', ')})`)
  for (const key of SAMPLING_KEYS) {
    const number = value[key]
    if (number === undefined) continue
    const { min, max } = SAMPLING_RANGES[key]
    if (typeof number !== 'number' || !Number.isFinite(number) || number < min || number > max) problems.push(`${where}.${key} must be a number from ${min} to ${max}`)
    else sampling[key] = number
  }
  return sampling
}

/** The controls of a chat's settings that are not neutral, as a model request carries them. */
export function sharedSamplingOf(settings: Record<SharedSamplingKey, number>): Partial<Record<SharedSamplingKey, number>> {
  return Object.fromEntries(SHARED_SAMPLING.flatMap(key => (settings[key] === SAMPLING_RANGES[key].neutral ? [] : [[key, settings[key]] as const])))
}
