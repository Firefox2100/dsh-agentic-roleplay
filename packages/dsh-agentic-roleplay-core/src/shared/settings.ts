/** What can be set for one chat. Stored as a file next to the chat's database: it is configuration, not story state. */
export interface ChatSettings {
  /**
   * The most rounds of characters acting that the game master may run for one player message
   * before the story must come back to the player.
   */
  maxRounds: number
}

export const MIN_ROUNDS = 1
export const MAX_ROUNDS = 10

export const DEFAULT_SETTINGS: ChatSettings = { maxRounds: 3 }

export type SettingsParse = { ok: true; value: ChatSettings } | { ok: false; problems: string[] }

/** Checks a settings value; fields left out take their default, anything unknown is refused. */
export function parseSettings(value: unknown): SettingsParse {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return { ok: false, problems: ['the settings must be an object'] }
  const input = value as Record<string, unknown>
  const problems = Object.keys(input).filter(key => key !== 'maxRounds').map(key => `"${key}" is not a setting`)
  const maxRounds = 'maxRounds' in input ? input['maxRounds'] : DEFAULT_SETTINGS.maxRounds
  if (typeof maxRounds !== 'number' || !Number.isInteger(maxRounds) || maxRounds < MIN_ROUNDS || maxRounds > MAX_ROUNDS) {
    problems.push(`"maxRounds" must be a whole number from ${MIN_ROUNDS} to ${MAX_ROUNDS}`)
  }
  return problems.length > 0 ? { ok: false, problems } : { ok: true, value: { maxRounds: maxRounds as number } }
}

/** The settings of a chat as the API gives them, with the bounds the form needs. */
export interface SettingsPayload {
  settings: ChatSettings
  limits: { minRounds: number; maxRounds: number }
}
