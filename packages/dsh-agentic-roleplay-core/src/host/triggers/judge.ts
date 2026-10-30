import type { Agent } from '@deepseek-ai/dsh-agent'
import type { DecisionService } from '@dsh-ai-providers/core'
import type { ObjectJsonSchema } from '@deepseek-ai/dsh-tools'
import { judgedStatements } from '@dsh-agentic-roleplay/state'
import { estimateAnswer } from '../agents/budget.ts'
import { childModel, childSampling, childTrace, runChild } from '../agents/child.ts'
import { promptFor } from '../prompts/access.ts'
import type { JudgeJob, TriggerJudge } from '../orchestration/boundaries.ts'
import { announceProblem, askYesNo, modeFor, noAt, routeVerdicts, yesAt } from '../decisions/route.ts'
import { readVerdicts, writeVerdicts } from './judged.ts'

const RESULT: ObjectJsonSchema = {
  type: 'object',
  properties: {
    verdicts: {
      type: 'array',
      items: { type: 'object', properties: { number: { type: 'integer', description: 'The number of the statement, as listed.' }, holds: { type: 'boolean' }, reason: { type: 'string', description: 'A short reason that points at what you were shown.' } }, required: ['number', 'holds', 'reason'], additionalProperties: false },
      description: 'One verdict for each statement.',
    },
  },
  required: ['verdicts'],
  additionalProperties: false,
}

/** The longest reason a verdict gives, in characters: what the answer is given room for besides its number and its yes or no. */
const REASON_CHARS = 600

/** The statements of the triggers still waiting, each once. */
export function waitingStatements(job: Pick<JudgeJob, 'store'>): string[] {
  return [...new Set(job.store.story.triggers.list({ status: 'dormant' }).flatMap(trigger => judgedStatements(trigger.condition)))]
}

/** What the story has recorded lately and where each character is, for whoever judges the statements. */
function sceneOf(job: JudgeJob): { events: string[]; cast: string[] } {
  return {
    events: job.store.story.events.list().slice(-15).map(event => event.text),
    cast: job.store.cast().map(member => `${member.character.name}${member.place === undefined ? '' : ` (at ${member.place.location.name})`}${member.state === undefined ? '' : `: ${[member.state.publicState, member.state.activity].filter(text => text !== '').join('; ')}`}`),
  }
}

function brief(scene: ReturnType<typeof sceneOf>, statements: readonly string[]): string {
  return [
    'Statements to judge:',
    ...statements.map((statement, index) => `${index + 1}. ${statement}`),
    `Recorded events, the latest last:\n${scene.events.map(event => `- ${event}`).join('\n') || '- none yet'}`,
    `Where everyone is and what they are doing:\n${scene.cast.map(line => `- ${line}`).join('\n') || '- nobody'}`,
  ].join('\n\n')
}

/**
 * After a turn, says whether the statements that triggers wait on hold now, for no more than `triggers.judgedPerTurn` of them, the
 * longest unjudged first. The language model judges them in one request; a decision model, when the chat is set to use one, answers a
 * yes-or-no question for each in one request of its own (see `decisions.triggers`). The verdicts are stored; a trigger fires from
 * them at the next look, like from any other condition.
 */
export function triggerJudge(deps: { agentOf: (chat: string) => Agent | undefined; decisions?: () => DecisionService | undefined; problem?: (message: string) => void }): TriggerJudge {
  const seen = new Map<string, string>()
  return {
    async judge(job, signal) {
      const { judgedPerTurn } = job.store.settings().triggers
      const waiting = waitingStatements(job)
      const verdicts = readVerdicts(job.store.story)
      writeVerdicts(job.store.story, verdicts, new Set(waiting))
      if (judgedPerTurn === 0 || waiting.length === 0) return { judged: 0 }
      const statements = [...waiting].sort((a, b) => (verdicts[a]?.turn ?? -1) - (verdicts[b]?.turn ?? -1)).slice(0, judgedPerTurn)
      const parent = deps.agentOf(job.chat)
      if (parent === undefined) throw new Error(`no agent for chat ${job.chat}`)
      const store = job.store
      const settings = store.settings()
      const scene = sceneOf(job)
      const statementOf = (key: number): string => statements[key - 1]!

      const askLanguageModel = async (keys: readonly number[]): Promise<Map<number, boolean>> => {
        const subset = keys.map(statementOf)
        const answer = await runChild<{ verdicts: { number: number; holds: boolean }[] }>({
          parent, signal, reasoningEffort: settings.reasoning.children, sampling: childSampling(settings, 'records', estimateAnswer(subset.flatMap(() => [REASON_CHARS, 0, 0]), settings.prompts.language)), ...childModel(settings, 'records'), trace: childTrace(store, 'records', 'trigger judge'),
          persona: promptFor(parent, 'roleplay/trigger-judge', settings.prompts.language),
          prompt: brief(scene, subset),
          result: RESULT,
          beforeSubmit: (value) => {
            const numbers = (value as { verdicts: { number: number }[] }).verdicts.map(verdict => verdict.number)
            const missing = subset.flatMap((_, index) => (numbers.includes(index + 1) ? [] : [index + 1]))
            return missing.length === 0 ? undefined : `judge every statement: ${missing.join(', ')} ${missing.length === 1 ? 'has' : 'have'} no verdict`
          },
          maxCalls: 3,
        })
        return new Map(answer.verdicts.flatMap(verdict => (keys[verdict.number - 1] === undefined ? [] : [[keys[verdict.number - 1]!, verdict.holds] as const])))
      }

      const askDecisionModel = async (keys: readonly number[]): Promise<Map<number, number>> => {
        const service = deps.decisions?.()
        if (service === undefined) throw new Error('no decision service is selected, or the selected one is not loaded')
        const asked = await askYesNo(service, { recorded_events: scene.events.length === 0 ? ['none yet'] : scene.events, where_everyone_is: scene.cast.length === 0 ? ['nobody'] : scene.cast },
          keys.map(key => ({ key: `s${key}`, instructions: store.text('roleplay/decide-trigger', { statement: statementOf(key) }) })), signal)
        return new Map(keys.map(key => [key, asked.get(`s${key}`)!]))
      }

      const routed = await routeVerdicts<number>({
        mode: modeFor(settings.decisions.triggers, deps.decisions?.()), yesAt: yesAt(settings.decisions.confidence), noAt: noAt(settings.decisions.confidence), turn: job.turn,
        keys: statements.map((_, index) => index + 1), what: statementOf, probabilities: askDecisionModel, llm: askLanguageModel,
      }, signal)
      announceProblem(seen, `${job.chat}:triggers`, routed.report, deps.problem)
      store.recordDecisions?.('triggers', routed.report)

      const next = readVerdicts(store.story)
      for (const [key, holds] of routed.verdicts) next[statementOf(key)] = { holds, turn: job.turn }
      writeVerdicts(store.story, next, new Set(waiting))
      return { judged: routed.verdicts.size }
    },
  }
}
