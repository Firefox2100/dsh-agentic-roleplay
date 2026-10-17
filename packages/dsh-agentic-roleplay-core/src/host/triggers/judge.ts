import type { Agent } from '@deepseek-ai/dsh-agent'
import type { ObjectJsonSchema } from '@deepseek-ai/dsh-tools'
import { judgedStatements } from '@dsh-agentic-roleplay/state'
import { FIELD_TOKENS } from '../agents/budget.ts'
import { childModel, childSampling, childTrace, runChild } from '../agents/child.ts'
import { promptFor } from '../prompts/access.ts'
import type { JudgeJob, TriggerJudge } from '../orchestration/boundaries.ts'
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

/** The statements of the triggers still waiting, each once. */
export function waitingStatements(job: Pick<JudgeJob, 'store'>): string[] {
  return [...new Set(job.store.story.triggers.list({ status: 'dormant' }).flatMap(trigger => judgedStatements(trigger.condition)))]
}

function brief(job: JudgeJob, statements: readonly string[]): string {
  const events = job.store.story.events.list().slice(-15).map(event => `- ${event.text}`)
  const cast = job.store.cast().map(member => `- ${member.character.name}${member.place === undefined ? '' : ` (at ${member.place.location.name})`}${member.state === undefined ? '' : `: ${[member.state.publicState, member.state.activity].filter(text => text !== '').join('; ')}`}`)
  return [
    'Statements to judge:',
    ...statements.map((statement, index) => `${index + 1}. ${statement}`),
    `Recorded events, the latest last:\n${events.join('\n') || '- none yet'}`,
    `Where everyone is and what they are doing:\n${cast.join('\n') || '- nobody'}`,
  ].join('\n\n')
}

/**
 * After a turn, has a model say whether the statements that triggers wait on hold now, for no more than `triggers.judgedPerTurn` of them, the
 * longest unjudged first, in one request. The verdicts are stored; a trigger fires from them at the next look, like from any other condition.
 */
export function triggerJudge(deps: { agentOf: (chat: string) => Agent | undefined }): TriggerJudge {
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
      const answer = await runChild<{ verdicts: { number: number; holds: boolean }[] }>({
        parent, signal, reasoningEffort: store.settings().reasoning.children, sampling: childSampling(store.settings(), 'records', statements.length * 2 * FIELD_TOKENS + FIELD_TOKENS), ...childModel(store.settings(), 'records'), trace: childTrace(store, 'records', 'trigger judge'),
        persona: promptFor(parent, 'roleplay/trigger-judge', store.settings().prompts.language),
        prompt: brief(job, statements),
        result: RESULT,
        beforeSubmit: (value) => {
          const numbers = (value as { verdicts: { number: number }[] }).verdicts.map(verdict => verdict.number)
          const missing = statements.flatMap((_, index) => (numbers.includes(index + 1) ? [] : [index + 1]))
          return missing.length === 0 ? undefined : `judge every statement: ${missing.join(', ')} ${missing.length === 1 ? 'has' : 'have'} no verdict`
        },
        maxCalls: 3,
      })
      const next = readVerdicts(store.story)
      for (const verdict of answer.verdicts) {
        const statement = statements[verdict.number - 1]
        if (statement !== undefined) next[statement] = { holds: verdict.holds, turn: job.turn }
      }
      writeVerdicts(store.story, next, new Set(waiting))
      return { judged: answer.verdicts.length }
    },
  }
}
