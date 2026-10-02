export const INTENT_TYPES = ['need', 'obligation', 'quest', 'agenda', 'aspiration', 'relationship', 'habit', 'reaction'] as const
export const INTENT_STATUSES = ['active', 'paused', 'completed', 'failed', 'abandoned'] as const
export const INTENT_HORIZONS = ['immediate', 'short', 'day', 'long', 'open_ended'] as const

export type IntentType = typeof INTENT_TYPES[number]
export type IntentStatus = typeof INTENT_STATUSES[number]
export type IntentHorizon = typeof INTENT_HORIZONS[number]

/** A driving thread behind what a character does. */
export interface Intent {
  type: IntentType
  name: string
  description: string
  status: IntentStatus
  horizon: IntentHorizon
  /** 0 to 1. */
  priority: number
  /** 0 to 1. */
  urgency: number
  plan: string[]
  openThreads: string[]
  constraints: string[]
  /** ISO 8601 date-time. */
  deadline?: string
}
