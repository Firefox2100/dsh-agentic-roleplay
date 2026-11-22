import type { Agent } from '@deepseek-ai/dsh-agent'
import type { DecisionService } from '@dsh-ai-providers/core'
import type { SituationGate, SituationJob } from '../orchestration/boundaries.ts'
import { faultOf, type Question } from './gates.ts'

const QUESTION: Question<SituationJob> = {
  prompt: 'roleplay/gate-situation',
  state: job => ({ player_character: job.player, player_message: job.input, situation: job.situation }),
  brief: job => `The player's character: ${job.player}\n\nThe player's message:\n${job.input}\n\nThe situation to check:\n${job.situation}`,
  what: job => job.situation,
}

/** What the game master is told when the situation carries what the characters could not have perceived. */
const MESSAGE = 'the situation tells the characters something they could not have perceived (what the player\'s character only thinks, feels or hides, or a person or thing only that mentions): write only what each of them could see or hear of the moment, and ask again'

/**
 * Checks the situation the game master gives the characters at the first round of a turn, when the chat's `decisions.situation` is on, by the language model, a decision model or both.
 * In `hybrid` (the default) nothing is asked while no decision model is selected, so a story without one costs no extra call. A check that cannot be made never stops the turn: it is reported once and the situation goes on as it is.
 */
export function situationChecks(deps: { agentOf: (chat: string) => Agent | undefined; decisions?: () => DecisionService | undefined; problem?: (message: string) => void }): SituationGate {
  const seen = new Map<string, string>()
  return {
    async check(job, signal): Promise<string | undefined> {
      const mode = job.store.settings().decisions.situation
      if (mode === 'off' || job.input.trim() === '' || job.situation.trim() === '') return undefined
      if (mode === 'hybrid' && deps.decisions?.() === undefined) return undefined
      try {
        return await faultOf('situation', QUESTION, job, { agentOf: deps.agentOf, ...deps.decisions === undefined ? {} : { decisions: deps.decisions }, seen, ...deps.problem === undefined ? {} : { problem: deps.problem } }, signal) ? MESSAGE : undefined
      } catch (error) {
        if (signal.aborted) throw error
        deps.problem?.(`the situation check of turn ${job.turn} could not be made, the situation goes on as it is: ${error instanceof Error ? error.message : String(error)}`)
        return undefined
      }
    },
  }
}
