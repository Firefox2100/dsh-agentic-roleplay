import type { Agent } from '@deepseek-ai/dsh-agent'
import { createCharacterTools, type Recalled } from '@dsh-agentic-roleplay/state'
import type { ObjectJsonSchema } from '@deepseek-ai/dsh-tools'
import { MAX_RUN_RECALLED, type RunRecall } from '../../shared/activity.ts'
import { childModel, childSampling, childTrace, runChild } from '../agents/child.ts'
import type { Boundaries, TurnStore } from './boundaries.ts'
import { AWAY_ACTION_SCHEMA, CHARACTER_ACTION_SCHEMA, parseCharacterAction } from './protocol.ts'
import type { RunAnswer, RunCharacter } from './turn-engine.ts'

/**
 * Runs each character as a one-shot child of the game master. It is the character and nothing
 * else: it knows what its brief gives it, and its only tool (when the chat allows it) reaches
 * the memory of that character alone, so characters acting at the same time cannot see each
 * other's memories.
 */
export function characterRunner(deps: { parent: Agent; boundaries: () => Boundaries; store: TurnStore }): RunCharacter {
  return async (request, signal) => {
    const brief = deps.boundaries().characterContext.brief(request)
    const tools = request.lookup
      ? createCharacterTools(() => ({ session: deps.store.story, turn: request.turn, policy: deps.store.settings().memory, queryVector: deps.store.queryVector }), request.member.character.id)
      : []
    const result = await runChild({ parent: deps.parent, signal, sampling: childSampling(deps.store.settings(), 'characters'), ...childModel(deps.store.settings(), 'characters'), trace: childTrace(deps.store, 'characters', request.member.character.name, recalledOf(request)), reasoningEffort: deps.store.settings().reasoning.children, persona: brief.persona, prompt: brief.prompt, tools, maxCalls: deps.store.settings().memory.lookupCalls, result: request.away === true ? AWAY_ACTION_SCHEMA : CHARACTER_ACTION_SCHEMA })
    return parseCharacterAction(result)
  }
}

/** What the character was reminded of and why, for the run's record, when the recall said why. */
function recalledOf(request: { memories?: readonly Recalled[] }): { recalled?: RunRecall[] } {
  const explained = (request.memories ?? []).filter(memory => memory.why !== undefined)
  return explained.length === 0 ? {} : { recalled: explained.slice(0, MAX_RUN_RECALLED).map(({ clarity, turn, text, why }) => ({ clarity, turn, text, why: why! })) }
}

const ANSWER_SCHEMA: ObjectJsonSchema = {
  type: 'object',
  properties: { answer: { type: 'string', description: 'The answer to the player, in plain words, in a few sentences.' } },
  required: ['answer'],
  additionalProperties: false,
}

/**
 * Answers a player's question as an agent that has only what the player's character is given when it acts: the character sheet is left out and nothing the
 * game master alone knows is in the prompt, so the answer cannot give away what the character could not know.
 */
export function answerRunner(deps: { parent: Agent; boundaries: () => Boundaries; store: TurnStore }): RunAnswer {
  return async (request, signal) => {
    const brief = deps.boundaries().characterContext.brief(request)
    const result = await runChild<{ answer: string }>({
      parent: deps.parent, signal, sampling: childSampling(deps.store.settings(), 'records'), ...childModel(deps.store.settings(), 'records'), trace: childTrace(deps.store, 'records', 'answer to the player'), reasoningEffort: deps.store.settings().reasoning.children,
      persona: request.text('roleplay/ask-answerer', { name: request.member.character.name }), prompt: brief.prompt, tools: [], maxCalls: 3, result: ANSWER_SCHEMA,
    })
    return result.answer
  }
}
