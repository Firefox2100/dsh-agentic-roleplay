/**
 * How much of the assistant's tool list a world's authoring chat leaves out while it cannot be used. A changed list makes the model server read the whole conversation
 * again at the next request, so the person chooses between a short request and a cache that keeps working:
 * `off` offers every tool always; `card` leaves out the card tools of a world that has no card; `phase` also follows the import (see `tool-visibility.ts`).
 */
export const TOOL_HIDING = ['off', 'card', 'phase'] as const
export type ToolHiding = (typeof TOOL_HIDING)[number]
export const DEFAULT_TOOL_HIDING: ToolHiding = 'card'

/** How many turns, counting the one being played, keep the results of their tool calls in the conversation; 0 keeps every result. */
export const MAX_KEEP_RESULT_TURNS = 20
export const DEFAULT_KEEP_RESULT_TURNS = 2

export interface AuthoringSettings {
  toolHiding: ToolHiding
  keepResultTurns: number
}

export const isKeepResultTurns = (value: unknown): value is number => typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= MAX_KEEP_RESULT_TURNS

export const isToolHiding = (value: unknown): value is ToolHiding => typeof value === 'string' && (TOOL_HIDING as readonly string[]).includes(value)

/** Reads the body of a settings change; only the fields it holds are returned. @throws {TypeError} for a value that is not allowed. */
export function parseAuthoringSettings(body: unknown): Partial<AuthoringSettings> {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) throw new TypeError('the settings must be an object')
  const input = body as Record<string, unknown>
  const unknown = Object.keys(input).filter(key => key !== 'toolHiding' && key !== 'keepResultTurns')
  if (unknown.length > 0) throw new TypeError(`unknown settings: ${unknown.join(', ')}`)
  const parsed: Partial<AuthoringSettings> = {}
  if (input['toolHiding'] !== undefined) {
    if (!isToolHiding(input['toolHiding'])) throw new TypeError(`toolHiding must be one of ${TOOL_HIDING.join(', ')}`)
    parsed.toolHiding = input['toolHiding']
  }
  if (input['keepResultTurns'] !== undefined) {
    if (!isKeepResultTurns(input['keepResultTurns'])) throw new TypeError(`keepResultTurns must be a whole number from 0 to ${MAX_KEEP_RESULT_TURNS}`)
    parsed.keepResultTurns = input['keepResultTurns']
  }
  return parsed
}
