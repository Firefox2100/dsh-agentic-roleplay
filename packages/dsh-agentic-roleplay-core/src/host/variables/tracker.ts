import type { Agent } from '@deepseek-ai/dsh-agent'
import type { JsonSchemaNode, ObjectJsonSchema } from '@deepseek-ai/dsh-tools'
import type { DecisionService } from '@dsh-ai-providers/core'
import { languageOf, translator, type VariableDefinition, type VariableValue } from 'dsh-roleplay-model'
import { estimateAnswer } from '../agents/budget.ts'
import { childModel, childSampling, childTrace, runChild } from '../agents/child.ts'
import type { TrackJob, TurnStore, VariableTracker } from '../orchestration/boundaries.ts'
import { announceProblem, askYesNo, routeVerdicts } from '../decisions/route.ts'
import { promptFor } from '../prompts/access.ts'

/** How far below the threshold a probability may fall and still be not sure: the same band as the other checks of what happened. */
const BAND = 0.15

/** What the models are shown of the turn, in characters: enough for what happened, never the whole story. */
const NARRATION_CHARS = 2400
const DEEDS_CHARS = 2400

/** One true-or-false for each key, named by the key: a list of {key, changed} was written by the server with `changed` before `key` (alphabetical), so the answer came before the question and was no for all of them. */
const verdictSchema = (keys: readonly string[]): ObjectJsonSchema => ({
  type: 'object',
  properties: Object.fromEntries(keys.map(key => [key, { type: 'boolean' as const }])),
  required: [...keys],
  additionalProperties: false,
})

/** The new value of each changed key, typed by what the value is: a free choice of types let the model write a number as text, which the story refused. */
const valuesSchema = (items: readonly TrackedItem[]): ObjectJsonSchema => ({
  type: 'object',
  properties: Object.fromEntries(items.map((item): [string, JsonSchemaNode] => {
    const { variable } = item
    if (variable.kind === 'flag') return [item.key, { type: 'boolean' }]
    if (variable.kind === 'choice') return [item.key, { type: 'string', enum: [...variable.options] }]
    return [item.key, { type: variable.integer ? 'integer' : 'number' }]
  })),
  required: items.map(item => item.key),
  additionalProperties: false,
})

/** One value of one subject the story tracks, as the models are asked about it. */
export interface TrackedItem {
  key: string
  variable: VariableDefinition
  subject: { key: string; name: string }
  value: VariableValue
}

const shown = (value: VariableValue): string => (typeof value === 'boolean' ? (value ? 'true' : 'false') : String(value))

/**
 * The values to look at after a turn: every value the world declared (not the built-in feelings, which the characters' own answers carry) for the world and for the player's character and the
 * characters the turn names (`scene` is what it said), where it applies.
 */
export function trackedItems(store: TurnStore, scene = ''): TrackedItem[] {
  const { variables } = store.story
  const cast = store.cast().filter(member => member.character.control === 'player' || scene.toLowerCase().includes(member.character.name.toLowerCase())).map(member => ({ key: member.key, name: member.character.name, id: member.character.id as number }))
  return variables.defs().filter(def => !def.builtin).flatMap((def): TrackedItem[] => {
    const subjects = def.subject === 'world' ? [{ key: 'world', name: '', id: 0 }] : def.subject === 'character' ? cast : []
    return subjects.filter(subject => variables.applies(def, def.subject, subject.id)).map(subject => ({
      key: `${def.key}:${subject.key}`, variable: def, subject: { key: subject.key, name: subject.name }, value: variables.value(def.key, def.subject, subject.id),
    }))
  })
}

/** How the value changes, as the world says it, with the space that sets it apart from the description; nothing when the world gives no rule. */
const ruleOf = (def: VariableDefinition, tr: ReturnType<typeof translator>): string => (def.update.trim() === '' ? '' : ` ${tr('Changes: {rule}', { rule: def.update.trim() })}`)

const ownerOf = (item: TrackedItem, tr: ReturnType<typeof translator>): string => (item.subject.key === 'world' ? tr('the story') : item.subject.name)

function question(store: TurnStore, item: TrackedItem, tr: ReturnType<typeof translator>): string {
  return store.text('roleplay/decide-variable', { subject: ownerOf(item, tr), name: item.variable.name, description: item.variable.description, update: ruleOf(item.variable, tr), value: shown(item.value) })
}

/** What the language model is told of the turn, then the values it is asked about. */
function brief(job: TrackJob, items: readonly TrackedItem[], tr: ReturnType<typeof translator>, heading: string): string {
  const range = (def: VariableDefinition): string => (def.kind === 'number' ? ` (${def.min ?? '…'} to ${def.max ?? '…'}${def.integer ? ', whole numbers' : ''})` : def.kind === 'choice' ? ` (${def.options.join(', ')})` : '')
  return [
    job.input.trim() === '' ? undefined : `${tr('What the player wrote:')}\n${job.input.slice(0, NARRATION_CHARS)}`,
    `${tr('What the characters did and said:')}\n${job.deeds.join('\n').slice(0, DEEDS_CHARS)}`,
    `${tr('What the player read:')}\n${job.narration.slice(0, NARRATION_CHARS)}`,
    `${heading}\n${items.map(item => `- ${item.key}: ${ownerOf(item, tr)}, ${item.variable.name}${range(item.variable)}. ${item.variable.description}${ruleOf(item.variable, tr)} ${tr('Now: {value}.', { value: shown(item.value) })}`).join('\n')}`,
  ].filter(part => part !== undefined).join('\n\n')
}

/**
 * Looks at the values the story tracks after each turn (`decisions.variables`): one question for each value and each person it applies to, whether what happened changed it, put to the
 * language model, the decision model or both as the setting says; the language model then gives the new value of those that did. The game master changes a value only when it thinks of
 * it; this makes sure every value is looked at. A failure is reported and leaves the values as they were.
 */
export function variableTracker(deps: {
  agentOf: (chat: string) => Agent | undefined
  decisions?: () => DecisionService | undefined
  problem?: (message: string) => void
  /** Puts a question to the language model; replaced in tests. */
  ask?: (request: { persona: string; prompt: string; result: ObjectJsonSchema; label: string }) => Promise<unknown>
}): VariableTracker {
  const seen = new Map<string, string>()
  return {
    async track(job, signal): Promise<number> {
      const settings = job.store.settings()
      const mode = settings.decisions.variables
      if (mode === 'off') return 0
      const items = trackedItems(job.store, `${job.input}\n${job.deeds.join('\n')}\n${job.narration}`)
      if (items.length === 0) return 0
      const parent = deps.agentOf(job.chat)
      const tr = translator(languageOf(settings.prompts.language))
      const byKey = new Map(items.map(item => [item.key, item]))
      const personaOf = (id: string): string => (parent === undefined ? job.store.text(id) : promptFor(parent, id, settings.prompts.language))
      const ask = async (persona: string, prompt: string, result: ObjectJsonSchema, answers: number, label: string): Promise<unknown> => {
        if (deps.ask !== undefined) return await deps.ask({ persona, prompt, result, label })
        if (parent === undefined) throw new Error(`no agent for chat ${job.chat}`)
        return await runChild<unknown>({
          parent, signal, reasoningEffort: settings.reasoning.children, sampling: childSampling(settings, 'records', estimateAnswer(Array.from({ length: answers }, () => 40), settings.prompts.language)), ...childModel(settings, 'records'),
          trace: childTrace(job.store, 'records', label), turn: job.turn, structured: true, persona, prompt, result, maxCalls: 2,
        })
      }
      try {
        const routed = await routeVerdicts<string>({
          mode, yesAt: settings.decisions.gateThreshold, noAt: Math.max(0, settings.decisions.gateThreshold - BAND), turn: job.turn, keys: items.map(item => item.key), what: key => `${byKey.get(key)!.variable.name}: ${byKey.get(key)!.subject.name}`,
          probabilities: async (keys) => {
            const service = deps.decisions?.()
            if (service === undefined) throw new Error('no decision service is selected, or the selected one is not loaded')
            const state = { happened: job.deeds.join('\n').slice(0, DEEDS_CHARS), narration: job.narration.slice(0, NARRATION_CHARS), ...(job.input.trim() === '' ? {} : { player_wrote: job.input }) }
            return await askYesNo(service, state, keys.map(key => ({ key, instructions: question(job.store, byKey.get(key)!, tr) })), signal)
          },
          llm: async (keys) => {
            const asked = keys.map(key => byKey.get(key)!)
            const answer = await ask(personaOf('roleplay/track-variables'), brief(job, asked, tr, tr('The values to look at:')), verdictSchema(keys), asked.length, 'tracked values') as Record<string, unknown>
            return new Map(keys.map(key => [key, answer[key] === true]))
          },
        }, signal)
        announceProblem(seen, `${job.chat}:variables`, routed.report, deps.problem)
        job.store.recordDecisions?.('variables', routed.report)
        const changed = items.filter(item => routed.verdicts.get(item.key) === true)
        if (changed.length === 0) return 0
        const answer = await ask(personaOf('roleplay/track-values'), brief(job, changed, tr, tr('The values that changed, to be given a new value:')), valuesSchema(changed), changed.length, 'new values') as Record<string, VariableValue>
        let set = 0
        const made: { key: string; from: string; to: string }[] = []
        for (const item of changed) {
          const change = { key: item.key, to: answer[item.key] }
          if (change.to === undefined || change.to === item.value) continue
          try {
            job.store.story.edit({ turn: job.turn, variableChanges: [{ variable: item.variable.key, subject: item.subject.key, to: change.to }] })
            set += 1
            made.push({ key: item.key, from: shown(item.value), to: shown(change.to) })
          } catch (error) {
            deps.problem?.(`the tracked value ${item.key} of turn ${job.turn} was not set to ${shown(change.to)}: ${error instanceof Error ? error.message : String(error)}`)
          }
        }
        if (made.length > 0) try { job.store.recordTrace?.(job.turn, { tracked: made }) } catch { /* the trace only describes the turn */ }
        return set
      } catch (error) {
        if (signal.aborted) throw error
        deps.problem?.(`the tracked values of turn ${job.turn} could not be looked at: ${error instanceof Error ? error.message : String(error)}`)
        return 0
      }
    },
  }
}
