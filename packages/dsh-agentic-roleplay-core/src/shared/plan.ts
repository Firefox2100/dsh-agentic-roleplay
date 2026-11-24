import type { JsonValue } from 'dsh-roleplay-model'

export const PLAN_KEY = 'roleplay.plan'
export const MAX_PLAN_ITEMS = 5
export const MAX_PLAN_TEXT = 300
export const MAX_PLAN_NOTE = 400

/** One thing the story is heading toward, what would make it pointless, and the triggers made to carry it. */
export interface PlanItem {
  text: string
  overturnedBy: string
  triggers: string[]
}

/** What the game master keeps in mind beyond the scene in front of it: private to the game master and the editors, never told to a character or shown in the chat. */
export interface StoryPlan {
  /** The turn the plan was last made or confirmed. */
  turn: number
  items: PlanItem[]
  /** A short direction for the game master's next scenes. */
  note: string
}

const text = (value: unknown, limit: number): string => (typeof value === 'string' ? value.trim().slice(0, limit) : '')

/** Reads a stored plan, leaving out whatever is not in the form; none for a story that has no plan. */
export function parsePlan(value: JsonValue | undefined): StoryPlan | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
  const { turn, items, note } = value as Record<string, unknown>
  if (typeof turn !== 'number' || !Array.isArray(items)) return undefined
  const kept: PlanItem[] = []
  for (const item of items.slice(0, MAX_PLAN_ITEMS)) {
    if (typeof item !== 'object' || item === null) continue
    const { text: said, overturnedBy, triggers } = item as Record<string, unknown>
    const body = text(said, MAX_PLAN_TEXT)
    if (body === '') continue
    kept.push({ text: body, overturnedBy: text(overturnedBy, MAX_PLAN_TEXT), triggers: Array.isArray(triggers) ? triggers.filter((key): key is string => typeof key === 'string') : [] })
  }
  return { turn, items: kept, note: text(note, MAX_PLAN_NOTE) }
}
