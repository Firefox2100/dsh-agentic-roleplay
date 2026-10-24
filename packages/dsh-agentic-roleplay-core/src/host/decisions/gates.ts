import type { Agent } from '@deepseek-ai/dsh-agent'
import type { ObjectJsonSchema } from '@deepseek-ai/dsh-tools'
import type { DecisionService } from '@dsh-ai-providers/core'
import { GATE_SITES, type GateSite } from '../../shared/decisions.ts'
import { estimateAnswer } from '../agents/budget.ts'
import { childModel, childSampling, childTrace, runChild } from '../agents/child.ts'
import { promptFor } from '../prompts/access.ts'
import type { GateFinding, GateJob, OutputGate } from '../orchestration/boundaries.ts'
import { announceProblem, askYesNo, routeVerdicts } from './route.ts'
import { askExtra, noteExtra } from './extras.ts'

/**
 * How far below the threshold a probability may fall and still be not sure. A decision model gives a rare fault a low probability even when it
 * sees it (measured: faults between 0.3 and 0.9, clean passages below 0.4), so a gate's cut is its own threshold, not the chat's confidence.
 */
const GATE_BAND = 0.15

/** What a verdict of the language model may say besides its yes or no, in characters: the room its answer is given. */
const REASON_CHARS = 400

const RESULT: ObjectJsonSchema = {
  type: 'object',
  properties: {
    reason: { type: 'string', description: 'One short sentence, written first: what the passage does, and whether that is the fault.' },
    fault: { type: 'boolean', description: 'Whether the passage has the fault.' },
  },
  required: ['reason', 'fault'],
  additionalProperties: false,
}

const ANSWER = 'Give your reason in one short sentence first, then say whether the passage has the fault.'

/** What a gate shows whoever judges, and what it tells the game master when the output fails. */
interface Gate {
  prompt: string
  /** What the decision model is given as its state. */
  state: (job: GateJob) => Record<string, unknown>
  /** What the language model is given as its request. */
  brief: (job: GateJob) => string
  /** Whether there is anything to check. */
  applies: (job: GateJob) => boolean
  /** What was checked, for the record of disagreements. */
  what: (job: GateJob) => string
  message: (job: GateJob) => string
}

const GATES: Record<GateSite, Gate> = {
  agency: {
    prompt: 'roleplay/gate-agency',
    state: job => ({ player_character: job.player, player_message: job.input, narration: job.narration }),
    brief: job => `The player's character: ${job.player}\n\nThe player's message:\n${job.input}\n\nThe narration to check:\n${job.narration}`,
    applies: job => job.input.trim() !== '' && job.narration.trim() !== '',
    what: job => job.narration,
    message: job => `the narration speaks, acts or thinks for ${job.player} beyond what the player wrote: let ${job.player} do only what the player's message says, and describe the world and what the others do instead`,
  },
  refusal: {
    prompt: 'roleplay/gate-refusal',
    state: job => ({ passage: job.passage }),
    brief: job => `The passage to check:\n${job.passage}`,
    applies: job => job.passage.trim() !== '',
    what: job => job.passage,
    message: () => 'the output steps out of the story (a refusal, a warning, a disclaimer or a remark to the player): write the scene as part of the story, in its own voice',
  },
}

/**
 * Checks the output of a turn for the faults the chat's settings switch on (`decisions.agency`, `decisions.refusal`), each by the language model, a
 * decision model, or both, as the setting says. A check that cannot be made never stops the turn: it is reported once, and the output goes on as it is.
 */
export function outputGates(deps: { agentOf: (chat: string) => Agent | undefined; decisions?: () => DecisionService | undefined; problem?: (message: string) => void }): OutputGate {
  const seen = new Map<string, string>()
  return {
    async check(job, signal): Promise<GateFinding[]> {
      const settings = job.store.settings()
      const parent = deps.agentOf(job.chat)
      const found = await Promise.all(GATE_SITES.map(async (site): Promise<GateFinding[]> => {
        const mode = settings.decisions[site]
        const gate = GATES[site]
        if (mode === 'off' || !gate.applies(job)) return []
        try {
          const routed = await routeVerdicts<string>({
            mode, yesAt: settings.decisions.gateThreshold, noAt: Math.max(0, settings.decisions.gateThreshold - GATE_BAND), turn: job.turn, keys: ['fault'], what: () => gate.what(job),
            probabilities: async () => {
              const service = deps.decisions?.()
              if (service === undefined) throw new Error('no decision service is selected, or the selected one is not loaded')
              const asked = await askYesNo(service, gate.state(job), [{ key: 'fault', instructions: job.store.text(gate.prompt) }], signal)
              return new Map([['fault', asked.get('fault')!]])
            },
            llm: async () => {
              if (parent === undefined) throw new Error(`no agent for chat ${job.chat}`)
              const answer = await runChild<{ reason: string; fault: boolean }>({
                parent, signal, reasoningEffort: settings.reasoning.children, sampling: childSampling(settings, 'records', estimateAnswer([REASON_CHARS, 0], settings.prompts.language)), ...childModel(settings, 'records'), trace: childTrace(job.store, 'records', `${site} check`),
                persona: `${promptFor(parent, gate.prompt, settings.prompts.language)}\n\n${ANSWER}`,
                prompt: gate.brief(job),
                result: RESULT,
                maxCalls: 2,
              })
              return new Map([['fault', answer.fault]])
            },
          }, signal)
          announceProblem(seen, `${job.chat}:${site}`, routed.report, deps.problem)
          job.store.recordDecisions?.(site, routed.report)
          return routed.verdicts.get('fault') === true ? [{ gate: site, message: gate.message(job) }] : []
        } catch (error) {
          if (signal.aborted) throw error
          deps.problem?.(`the ${site} check of turn ${job.turn} could not be made, the output goes on as it is: ${error instanceof Error ? error.message : String(error)}`)
          return []
        }
      }))
      return [...found.flat(), ...await secretFindings(job, settings.decisions, deps.decisions?.(), seen, signal, deps.problem)]
    },
  }
}

const SECRET_PROMPT = 'roleplay/gate-secret'

/** The hidden lore the output gives away, when the chat has `decisions.secrets` on: one question to the decision model for each fact, in one request. */
async function secretFindings(job: GateJob, decisions: { secrets: string; gateThreshold: number }, service: DecisionService | undefined, seen: Map<string, string>, signal: AbortSignal, say: ((message: string) => void) | undefined): Promise<GateFinding[]> {
  if (decisions.secrets === 'off' || job.secrets.length === 0 || job.passage.trim() === '') return []
  const asks = job.secrets.map((secret, index) => ({ key: `secret${index}`, instructions: job.store.text(SECRET_PROMPT, { secret: secret.text }) }))
  const { found, report } = await askExtra(service, { passage: job.passage }, asks, decisions.gateThreshold, signal)
  noteExtra('secrets', job.chat, job.store, report, seen, say)
  if (found.length === 0) return []
  const titles = found.map(key => job.secrets[Number(key.slice('secret'.length))]!.title)
  return [{ gate: 'secrets', message: `the output may give away what ${job.player === '' ? 'the player\'s character' : job.player} does not know yet (${titles.join('; ')}): show only what can be seen or heard, and let the rest be learned in the story; if this is meant to be revealed now, deliver it again unchanged` }]
}
