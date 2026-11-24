import type { JsonValue } from 'dsh-roleplay-model'
import { parsePlan, PLAN_KEY, type StoryPlan } from '../../shared/plan.ts'
import type { TurnStore } from '../orchestration/boundaries.ts'

export type PlanReason = 'first' | 'changed' | 'periodic' | 'manual'

type PlanSession = Pick<TurnStore['story'], 'metadata' | 'triggers' | 'threads'>

export const readPlan = (session: Pick<TurnStore['story'], 'metadata'>): StoryPlan | undefined => parsePlan(session.metadata.getValue(PLAN_KEY))

export const writePlan = (session: Pick<TurnStore['story'], 'metadata'>, plan: StoryPlan): void => {
  session.metadata.setValue(PLAN_KEY, plan as unknown as JsonValue)
}

/**
 * Whether the plan needs another look, from what the records say and no model: the first plan once the story has begun, a trigger the plan made that is
 * no longer waiting, a thread settled since the plan was made, and, as the fallback, a number of turns without a look.
 */
export function planDue(session: PlanSession, turn: number, plan: { minTurns: number; everyTurns: number }): Exclude<PlanReason, 'manual'> | undefined {
  const current = readPlan(session)
  if (current === undefined) return turn >= plan.minTurns ? 'first' : undefined
  const keys = current.items.flatMap(item => item.triggers)
  if (keys.some(key => { const trigger = session.triggers.getByKey(key); return trigger !== undefined && trigger.status !== 'dormant' })) return 'changed'
  if (session.threads.list('resolved').some(thread => (thread.resolvedTurn ?? 0) > current.turn)) return 'changed'
  return turn - current.turn >= plan.everyTurns ? 'periodic' : undefined
}
