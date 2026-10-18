import type { Agent } from '@deepseek-ai/dsh-agent'
import { createCharacterTools, type Recalled } from '@dsh-agentic-roleplay/state'
import type { ObjectJsonSchema } from '@deepseek-ai/dsh-tools'
import { MAX_RUN_RECALLED, type RunRecall } from '../../shared/activity.ts'
import { estimateAnswer } from '../agents/budget.ts'
import { externalGiven } from '../tools/external.ts'
import { toolEnabled } from '../../shared/tools.ts'
import { childModel, childSampling, childTrace, runChild } from '../agents/child.ts'
import { MAX_OOC_ANSWER } from '../../shared/ooc.ts'
import { wrongLanguage } from '../translate/language.ts'
import type { Boundaries, TurnStore } from './boundaries.ts'
import { AWAY_ACTION_SCHEMA, CHARACTER_ACTION_SCHEMA, answerEstimate, parseCharacterAction } from './protocol.ts'
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
    const settings = deps.store.settings()
    const tools = settings.memory.lookup
      ? createCharacterTools(() => ({ session: deps.store.story, turn: request.turn, policy: settings.memory, queryVector: deps.store.queryVector }), request.member.character.id).filter(tool => toolEnabled(settings.tools, 'characters', tool.name))
      : []
    const external = externalGiven(deps.parent.ctx.tools, settings.tools, 'characters')
    const named = request.member.character.tier === 'background' && settings.models.background.trim() !== '' ? settings.models.background : settings.models.characters
    const result = await runChild({ parent: deps.parent, signal, sampling: childSampling(settings, 'characters', answerEstimate(settings.prompts.language, request.away === true)), ...childModel(settings, 'characters', named), trace: childTrace(deps.store, 'characters', request.member.character.name, recalledOf(request), named), reasoningEffort: deps.store.settings().reasoning.children, persona: brief.persona, prompt: brief.prompt, tools, external, maxCalls: deps.store.settings().memory.lookupCalls + (external.length === 0 ? 0 : EXTERNAL_CALLS), result: request.away === true ? AWAY_ACTION_SCHEMA : CHARACTER_ACTION_SCHEMA, unenforced: ['thought'], beforeSubmit: value => spokenIn(settings.prompts.language, value) })
    return parseCharacterAction(result)
  }
}

/** What a character that was given tools of other plugins may call on top of its memory look-ups. */
const EXTERNAL_CALLS = 5

/** A character whose sheet is in another language than the chat's writes in the sheet's: the answer is refused until it is in the chat's. */
function spokenIn(language: string, value: unknown): string | undefined {
  const given = value as { thought?: string; intent?: string; utterance?: string; account?: string }
  return wrongLanguage(language, { thought: given.thought, intent: given.intent, utterance: given.utterance, account: given.account })
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
      parent: deps.parent, signal, sampling: childSampling(deps.store.settings(), 'records', estimateAnswer([MAX_OOC_ANSWER], deps.store.settings().prompts.language)), ...childModel(deps.store.settings(), 'records'), trace: childTrace(deps.store, 'records', 'answer to the player'), reasoningEffort: deps.store.settings().reasoning.children,
      persona: request.text('roleplay/ask-answerer', { name: request.member.character.name }), prompt: brief.prompt, tools: [], maxCalls: 3, result: ANSWER_SCHEMA,
    })
    return result.answer
  }
}
