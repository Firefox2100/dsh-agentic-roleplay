import type { Agent } from '@deepseek-ai/dsh-agent'
import type { SubagentRuntime } from '@deepseek-ai/dsh-subagent'
import type { Boundaries } from './boundaries.ts'
import { CHARACTER_ACTION_SCHEMA, parseCharacterAction } from './protocol.ts'
import type { RunCharacter } from './turn-engine.ts'

/**
 * Runs each character as a one-shot sub-agent of the game master. The sub-agent
 * gets the character as its persona and no tools, so it sees nothing but what
 * the character's brief gives it.
 */
export function subagentRunner(subagents: Pick<SubagentRuntime, 'start'>, boundaries: () => Boundaries, parent: Agent): RunCharacter {
  return async (request, signal) => {
    const brief = boundaries().characterContext.brief(request)
    const run = await subagents.start('spawn', {
      parent,
      signal,
      label: request.member.character.name,
      prompt: [{ type: 'text', text: brief.prompt }],
      persona: brief.persona,
      toolFilter: { allow: [] },
      outputSchema: CHARACTER_ACTION_SCHEMA,
    })
    try {
      const result = await run.result
      if (result.stopReason !== 'completed') throw new Error(`${request.member.character.name} did not finish (${result.stopReason})`)
      return parseCharacterAction(result.structured)
    } finally {
      await run.dispose()
    }
  }
}
