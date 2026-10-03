export type NarrationSegment =
  | { type: 'utterance'; character: string; name: string; text: string }
  | { type: 'narration'; text: string }

/** What the player is shown for a turn: utterances and narration, in order. */
export interface TurnOutput {
  segments: NarrationSegment[]
  /** Whether the output had to be corrected so that every utterance is as the character gave it. */
  repaired: boolean
}

/*
 * The checked output travels in the text of the result of the tool that delivers it. A tool
 * result is a durable event DSH knows, so the session reloads after a restart; an event of
 * our own would be refused as unknown. The client reads the output back from the same text.
 */
const OPEN = '<roleplay-output>'
const CLOSE = '</roleplay-output>'

export function encodeOutput(output: TurnOutput): string {
  return `${OPEN}${JSON.stringify(output)}${CLOSE}`
}

function isSegment(value: unknown): value is NarrationSegment {
  if (typeof value !== 'object' || value === null) return false
  const segment = value as Record<string, unknown>
  if (segment['type'] === 'narration') return typeof segment['text'] === 'string'
  return segment['type'] === 'utterance'
    && typeof segment['character'] === 'string' && typeof segment['name'] === 'string' && typeof segment['text'] === 'string'
}

/** The output encoded in a tool result's text, or nothing when the text carries none. */
export function decodeOutput(text: string): TurnOutput | undefined {
  const start = text.indexOf(OPEN)
  const end = text.indexOf(CLOSE, start + OPEN.length)
  if (start < 0 || end < 0) return undefined
  try {
    const value = JSON.parse(text.slice(start + OPEN.length, end)) as Record<string, unknown>
    const segments = value['segments']
    if (!Array.isArray(segments) || !segments.every(isSegment) || typeof value['repaired'] !== 'boolean') return undefined
    return { segments, repaired: value['repaired'] }
  } catch {
    return undefined
  }
}
