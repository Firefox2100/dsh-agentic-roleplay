import type { Agent } from '@deepseek-ai/dsh-agent'
import { createCharacterTools } from 'dsh-roleplay-state'
import { childSampling, runChild } from '../agents/child.ts'
import type { Boundaries, TurnStore } from './boundaries.ts'
import { CHARACTER_ACTION_SCHEMA, parseCharacterAction } from './protocol.ts'
import type { RunCharacter } from './turn-engine.ts'

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
    const result = await runChild({ parent: deps.parent, signal, sampling: childSampling(deps.store.settings(), 'characters'), reasoningEffort: deps.store.settings().reasoning.children, persona: brief.persona, prompt: brief.prompt, tools, result: CHARACTER_ACTION_SCHEMA })
    return parseCharacterAction(result)
  }
}
