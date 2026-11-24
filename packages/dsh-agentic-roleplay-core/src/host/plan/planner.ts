import type { Agent } from '@deepseek-ai/dsh-agent'
import type { ObjectJsonSchema } from '@deepseek-ai/dsh-tools'
import { InvalidEditError, parseRecordsEdit } from '@dsh-agentic-roleplay/state'
import { MAX_PLAN_ITEMS, MAX_PLAN_NOTE, MAX_PLAN_TEXT, type PlanItem } from '../../shared/plan.ts'
import { estimateAnswer } from '../agents/budget.ts'
import { childModel, childSampling, childTrace, runChild } from '../agents/child.ts'
import { describeWhen } from '../clock/story-clock.ts'
import type { PlanJob, PlanKeeper, PlanReport, TurnStore } from '../orchestration/boundaries.ts'
import { EFFECTS, WHEN } from '../orchestration/trigger-tools.ts'
import { promptFor } from '../prompts/access.ts'
import { readPlan, writePlan } from './plan.ts'

/** The effects a plan may use: it nudges the story and never changes its records. */
const SOFT_EFFECTS = ['beat', 'cue']

export interface PlanAnswer {
  check?: { item: number; pointless: boolean; shown_by?: string }[]
  unchanged?: boolean
  items?: { text: string; forces_player?: boolean; overturned_by?: string; trigger_keys?: string[] }[]
  note?: string
  triggers?: Record<string, unknown>[]
  cancel?: string[]
}

export const PLAN_RESULT: ObjectJsonSchema = {
  type: 'object',
  properties: {
    check: { type: 'array', description: 'First, for each item of the old plan, in order: whether what would make it pointless has happened since it was made, and in a few words what shows it. Leave empty when there is no plan yet.', items: {
      type: 'object',
      properties: { item: { type: 'integer', description: 'The number of the item, as listed.' }, pointless: { type: 'boolean' }, shown_by: { type: 'string', description: 'What has happened that shows it, or why it still stands.' } },
      required: ['item', 'pointless'], additionalProperties: false,
    } },
    unchanged: { type: 'boolean', description: 'True when the plan still stands as it is and nothing is to be added: then leave the other fields out.' },
    items: { type: 'array', description: 'The whole plan after this look, replacing the old one: what the story is heading toward, most pressing first. Empty when the story has not yet set anything going: do not invent.', items: {
      type: 'object',
      properties: { text: { type: 'string', description: 'One thing that is going to happen or keep pressing, and who or what drives it, in a sentence or two.' }, forces_player: { type: 'boolean', description: 'True when the item only happens if the player\'s character is made to do, say, decide or feel something the player has not chosen. A consequence that follows if the player chooses something, or an event in the world the player may meet or ignore, is false.' }, overturned_by: { type: 'string', description: 'What the player or the story could do that would make it pointless.' }, trigger_keys: { type: 'array', items: { type: 'string' }, description: 'The keys of the triggers that carry it, when there are any.' } },
      required: ['text', 'forces_player'], additionalProperties: false,
    } },
    note: { type: 'string', description: 'A short direction for the next scenes, addressed to the game master: what to keep in view, what to let develop. Never the plan itself written out.' },
    triggers: { type: 'array', description: 'Moments the story is bound to reach, made to fire by themselves. Beats and cues only.', items: {
      type: 'object',
      properties: { key: { type: 'string' }, name: { type: 'string' }, when: { type: 'object', description: WHEN, additionalProperties: true }, effects: { type: 'array', description: EFFECTS, items: { type: 'object', additionalProperties: true } }, expires: { type: 'string' }, chance: { type: 'number' } },
      required: ['key', 'name', 'when', 'effects'], additionalProperties: true,
    } },
    cancel: { type: 'array', items: { type: 'string' }, description: 'Keys of waiting triggers made in play that the story has overtaken.' },
  },
  additionalProperties: false,
}

const LIMITS = [...Array.from({ length: MAX_PLAN_ITEMS }, () => 100), MAX_PLAN_NOTE, ...Array.from({ length: MAX_PLAN_ITEMS * 2 }, () => MAX_PLAN_TEXT), 200, 200, 200]

class Undone extends Error {}

/** The reasons the story's own checks refuse a trigger, found by making it and taking it back, so the planner can correct it before its answer is accepted. */
function refusal(story: TurnStore['story'], turn: number, trigger: Record<string, unknown>): string | undefined {
  try {
    story.transaction(() => { story.edit(parseRecordsEdit({ turn, triggers: [trigger] })); throw new Undone() })
  } catch (error) {
    if (error instanceof Undone) return undefined
    const keys = `${story.locations.list().map(place => place.sourceId ?? place.id).join(', ') || 'none'}`
    return `trigger ${String(trigger.key)}: ${error instanceof InvalidEditError ? error.problems.join('; ') : error instanceof Error ? error.message : String(error)} (places are named by their keys: ${keys}; people by their ids as the brief lists them)`
  }
  return undefined
}

/**
 * What is wrong with a plan's answer: a trigger that changes records is always sent back; one the story would refuse is sent back once, with the reasons, and then left out
 * (the plan itself is worth more than a trigger the model cannot get right), so the check is made by a function that remembers.
 */
export const planChecker = (story: TurnStore['story'], turn: number, most: number): ((answer: PlanAnswer) => string | undefined) => {
  let refused = false
  let forced = false
  return (answer) => {
    const hard = softProblem(answer)
    if (hard !== undefined) return hard
    const driven = (answer.items ?? []).flatMap((item, index) => (item.forces_player === true ? [index + 1] : []))
    if (driven.length > 0 && !forced) {
      forced = true
      return `item ${driven.join(', ')} of the plan makes the player's character act, speak or feel as the story wants: the player decides that. Write it as what happens in the world, or as what follows if the player chooses something, or leave it out.`
    }
    if (refused) return undefined
    const problems = (answer.triggers ?? []).slice(0, most).map(trigger => refusal(story, turn, trigger)).filter((problem): problem is string => problem !== undefined)
    if (problems.length === 0) return undefined
    refused = true
    return problems.join('\n')
  }
}

export const softProblem = (answer: PlanAnswer): string | undefined => {
  for (const trigger of answer.triggers ?? []) {
    const effects = Array.isArray(trigger.effects) ? trigger.effects : []
    const hard = effects.find(effect => typeof effect === 'object' && effect !== null && !SOFT_EFFECTS.includes(String((effect as { type?: unknown }).type)))
    if (hard !== undefined) return `trigger ${String(trigger.key)} changes the records, which a plan may not do: use a beat (for the game master) or a cue (for characters) instead`
  }
  return undefined
}

export function planBrief(store: TurnStore, job: PlanJob, reason: string): string {
  const { story } = store
  const { now, zone } = store.time(job.turn)
  const plan = readPlan(story)
  const named = (id: number): string => story.characters.get(id)?.name ?? String(id)
  const goals = story.factions.list().flatMap(faction => story.factionIntents.list(faction.id, { status: 'active' }).map(goal => `- ${faction.name}: ${goal.name}${goal.plan.length === 0 ? '' : ` (next: ${goal.plan[0]})`}`))
  const mine = story.triggers.list().filter(trigger => trigger.origin === 'story')
  return [
    `Turn ${job.turn}. It is ${describeWhen(now, now, zone)} in the story. Why you are looking now: ${reason}.`,
    `People: ${story.characters.list().map(character => `${character.name}${character.control === 'player' ? ' (the player)' : ''}`).join(', ') || 'none'}`,
    `What has happened lately:\n${story.events.list().slice(-10).map(event => `- ${event.text}`).join('\n') || '- nothing yet'}`,
    `Open threads:\n${story.threads.list('open').map(thread => `- ${thread.text}`).join('\n') || '- none'}`,
    goals.length === 0 ? '' : `What organisations are working toward:\n${goals.join('\n')}`,
    (store.pins?.() ?? []).length === 0 ? '' : `What the player has fixed or leans toward:\n${(store.pins?.() ?? []).map(pin => `- ${pin}`).join('\n')}`,
    `Triggers made in play:\n${mine.map(trigger => `- ${trigger.key} (${trigger.status}): ${trigger.name}`).join('\n') || '- none'}`,
    plan === undefined ? 'There is no plan yet: make one.' : `The plan from turn ${plan.turn}:\n${plan.items.map((item, index) => `${index + 1}. ${item.text}${item.overturnedBy === '' ? '' : ` (pointless if: ${item.overturnedBy})`}${item.triggers.length === 0 ? '' : ` [${item.triggers.join(', ')}]`}`).join('\n') || '- empty'}\nDirection last given: ${plan.note || 'none'}`,
    `Places, by the keys triggers use: ${story.locations.list().map(place => `${place.sourceId ?? place.id} = ${place.name}`).join('; ') || 'none'}`,
    `People known to the story by their ids, for triggers: ${story.characters.list().map(character => `${character.sourceId ?? character.id} = ${named(character.id)}`).join('; ')}`,
  ].filter(line => line !== '').join('\n\n')
}

/**
 * Keeps the story's plan: a short private list of what it is heading toward, made and revised in the background when the records say something changed
 * (and, at the least, every few turns). It sets beats and cues only, so it can lean on the story but never write it, and a failure leaves the plan as it was.
 */
export function storyPlanner(deps: { agentOf: (chat: string) => Agent | undefined }): PlanKeeper {
  return {
    async keep(job: PlanJob, signal: AbortSignal): Promise<PlanReport> {
      const { store } = job
      const settings = store.settings()
      const parent = deps.agentOf(job.chat)
      if (parent === undefined) throw new Error(`no agent for chat ${job.chat}`)
      const check = planChecker(store.story, job.turn, settings.plan.perPass)
      const answer = await runChild<PlanAnswer>({
        parent, signal, turn: job.turn, reasoningEffort: settings.reasoning.children, sampling: childSampling(settings, 'authoring', estimateAnswer(LIMITS, settings.prompts.language)), ...childModel(settings, 'authoring'),
        trace: childTrace(store, 'authoring', 'story plan'),
        persona: promptFor(parent, 'roleplay/planner', settings.prompts.language),
        prompt: planBrief(store, job, job.reason),
        result: PLAN_RESULT,
        maxCalls: 3,
        beforeSubmit: (value) => check(value as PlanAnswer),
      })
      const { story } = store
      const previous = readPlan(story)
      const cancelled: string[] = []
      for (const key of answer.cancel ?? []) {
        const trigger = story.triggers.getByKey(key)
        if (trigger !== undefined && trigger.origin === 'story' && trigger.status === 'dormant') { story.triggers.update(trigger.id, { status: 'expired' }); cancelled.push(key) }
      }
      if (answer.unchanged === true && previous !== undefined) { writePlan(story, { ...previous, turn: job.turn }); return { changed: false, made: [], failed: [], cancelled } }
      const made: string[] = []
      const failed: string[] = []
      for (const trigger of (answer.triggers ?? []).slice(0, settings.plan.perPass)) {
        try {
          story.edit(parseRecordsEdit({ turn: job.turn, triggers: [trigger] }))
          made.push(String(trigger.key))
        } catch (error) {
          failed.push(`${String(trigger.key)}: ${error instanceof InvalidEditError ? error.problems.join('; ') : error instanceof Error ? error.message : String(error)}`)
        }
      }
      const known = new Set(story.triggers.list().filter(trigger => trigger.origin === 'story').map(trigger => trigger.key))
      const items: PlanItem[] = (answer.items ?? []).slice(0, MAX_PLAN_ITEMS).filter(item => item.text.trim() !== '' && item.forces_player !== true).map(item => ({ text: item.text.trim().slice(0, MAX_PLAN_TEXT), overturnedBy: (item.overturned_by ?? '').trim().slice(0, MAX_PLAN_TEXT), triggers: (item.trigger_keys ?? []).filter(key => known.has(key)) }))
      writePlan(story, { turn: job.turn, items, note: (answer.note ?? '').trim().slice(0, MAX_PLAN_NOTE) })
      return { changed: true, made, failed, cancelled }
    },
  }
}
