import type { Agent } from '@deepseek-ai/dsh-agent'
import type { ObjectJsonSchema } from '@deepseek-ai/dsh-tools'
import type { DecisionService } from '@dsh-ai-providers/core'
import { estimateAnswer } from '../agents/budget.ts'
import { childModel, childSampling, childTrace, runChild } from '../agents/child.ts'
import { promptFor } from '../prompts/access.ts'
import type { GateFinding, GateJob } from '../orchestration/boundaries.ts'
import { announceProblem, askYesNo, routeVerdicts } from './route.ts'

const PROMPT = 'roleplay/gate-repeat'
/** The most repeated sentences one output is asked about, and how much of the earlier turns the judge is shown. */
export const MAX_CANDIDATES = 6
const EARLIER_CHARS = 1500
const REASON_CHARS = 300
const GATE_BAND = 0.15

const sentencesOf = (text: string): string[] => text.split(/\n+|(?<=[.!?。！？…])\s*/).map(sentence => sentence.trim()).filter(sentence => sentence !== '')
const keyOf = (sentence: string): string => sentence.toLowerCase().replace(/\s+/g, ' ')

/** The sentences of the narration that an earlier turn, or an earlier place in the same narration, already told, as written now and once each. */
export function repeatedSentences(narration: string, earlier: readonly string[], minChars: number): string[] {
  const told = new Set(earlier.flatMap(text => sentencesOf(text).map(keyOf)))
  const found = new Map<string, string>()
  for (const sentence of sentencesOf(narration)) {
    const key = keyOf(sentence)
    if (key.length < minChars) continue
    if (told.has(key) && !found.has(key)) found.set(key, sentence)
    told.add(key)
  }
  return [...found.values()]
}

const RESULT: ObjectJsonSchema = {
  type: 'object',
  properties: {
    reason: { type: 'string', description: 'One short sentence, written first: which of the numbered sentences are stock lines used again for want of something new, and which are meant.' },
    stale: { type: 'array', items: { type: 'integer' }, description: 'The numbers of the sentences that are stale filler; empty when every repeat is meant.' },
  },
  required: ['reason', 'stale'],
  additionalProperties: false,
}

export interface RepeatDeps {
  agentOf: (chat: string) => Agent | undefined
  decisions?: () => DecisionService | undefined
  /** The narration of up to `count` of the turns before this one on the story's path, oldest first. */
  earlier: (chat: string, count: number) => string[]
  seen: Map<string, string>
  problem?: (message: string) => void
}

const asFinding = (stale: readonly string[]): GateFinding[] => (stale.length === 0 ? [] : [{
  gate: 'repeats',
  message: `the narration tells again, in the same words, ${stale.map(sentence => `"${sentence}"`).join('; ')}, which an earlier turn already used: say it differently, or leave it out if nothing new is to be said`,
}])

/**
 * The sentences of the narration that an earlier turn told in the same words, when the chat has `decisions.repeats` on. A sentence found by code is
 * stale or meant: `strict` counts every one as stale with no model; any other mode has the language model, the decision model or both say which.
 */
export async function repeatFindings(job: GateJob, deps: RepeatDeps, signal: AbortSignal): Promise<GateFinding[]> {
  const settings = job.store.settings()
  const mode = settings.decisions.repeats
  if (mode === 'off' || job.narration.trim() === '') return []
  const earlier = deps.earlier(job.chat, settings.decisions.repeatTurns)
  const candidates = repeatedSentences(job.narration, earlier, settings.decisions.repeatChars).slice(0, MAX_CANDIDATES)
  if (candidates.length === 0) return []
  if (mode === 'strict') return asFinding(candidates)
  const keys = candidates.map((_, index) => `repeat${index}`)
  const shown = (sentence: string): string => earlier.filter(text => text.toLowerCase().includes(sentence.toLowerCase())).join('\n').slice(-EARLIER_CHARS)
  try {
    const routed = await routeVerdicts<string>({
      mode, yesAt: settings.decisions.gateThreshold, noAt: Math.max(0, settings.decisions.gateThreshold - GATE_BAND), turn: job.turn, keys,
      what: key => candidates[Number(key.slice('repeat'.length))]!,
      probabilities: async () => {
        const service = deps.decisions?.()
        if (service === undefined) throw new Error('no decision service is selected, or the selected one is not loaded')
        const state = { narration: job.narration, earlier_turns: earlier.join('\n').slice(-EARLIER_CHARS) }
        return await askYesNo(service, state, candidates.map((sentence, index) => ({ key: keys[index]!, instructions: job.store.text(PROMPT, { sentence }) })), signal)
      },
      llm: async () => {
        const parent = deps.agentOf(job.chat)
        if (parent === undefined) throw new Error(`no agent for chat ${job.chat}`)
        const answer = await runChild<{ reason: string; stale: number[] }>({
          parent, signal, reasoningEffort: settings.reasoning.children, sampling: childSampling(settings, 'records', estimateAnswer([REASON_CHARS, 0], settings.prompts.language)), ...childModel(settings, 'records'), trace: childTrace(job.store, 'records', 'repeats check'),
          persona: `${promptFor(parent, PROMPT, settings.prompts.language, { sentence: 'each numbered sentence' })}\n\nGive your reason in one short sentence first, then the numbers of the sentences that are stale filler.`,
          prompt: `The narration:\n${job.narration}\n\nThe sentences told in an earlier turn:\n${candidates.map((sentence, index) => `${index + 1}. ${sentence}\n   Earlier: ${shown(sentence).slice(-300)}`).join('\n')}`,
          result: RESULT,
          maxCalls: 2,
        })
        return new Map(keys.map((key, index) => [key, answer.stale.includes(index + 1)]))
      },
    }, signal)
    announceProblem(deps.seen, `${job.chat}:repeats`, routed.report, deps.problem)
    job.store.recordDecisions?.('repeats', routed.report)
    return asFinding(candidates.filter((_, index) => routed.verdicts.get(keys[index]!) === true))
  } catch (error) {
    if (signal.aborted) throw error
    deps.problem?.(`the repeats check of turn ${job.turn} could not be made, the output goes on as it is: ${error instanceof Error ? error.message : String(error)}`)
    return []
  }
}
