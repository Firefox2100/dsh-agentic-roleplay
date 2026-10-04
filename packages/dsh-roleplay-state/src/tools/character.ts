import { defineTool, type ToolDefinition } from '@deepseek-ai/dsh-tools'
import type { CharacterId } from 'dsh-roleplay-model'
import { vectorOf, type AgentLink } from './index.ts'

/**
 * The tools of one character's own agent. They are built for that character and registered
 * on that agent alone, so what they return is only what that character took in and believes:
 * agents running side by side for different characters each get their own, and none can
 * reach another's memory.
 */
/** Where the character is, as a recall cue: what happened where it stands comes back more readily. */
const placeOf = (session: AgentLink['session'], characterId: CharacterId): { locationId?: number } => {
  const placement = session.placements.get('character', characterId)
  return placement === undefined ? {} : { locationId: placement.locationId }
}

export function createCharacterTools(link: () => AgentLink, characterId: CharacterId): ToolDefinition[] {
  return [
    defineTool({
      name: 'recall_my_memories',
      description: 'Ask yourself what you remember about something: a person, an object, a place or an earlier moment. You get your own version of it, what you took in yourself and what you believe, and what has faded comes back as hazy or not at all. Use it only when you need a memory that the situation does not already give you.',
      parameters: { about: { type: 'string', required: true, description: 'What to remember: a name, an object, a topic or a short description of the moment.' } },
      output: {
        schema: { type: 'array', items: { type: 'object', additionalProperties: false, properties: { clarity: { type: 'string', required: true }, turn: { type: 'integer', required: true }, text: { type: 'string', required: true } } } },
        render: (_args, value) => [{ type: 'text', text: value.length === 0 ? 'You do not remember anything about that.' : value.map(entry => `- (${entry.clarity === 'clear' ? '' : entry.clarity === 'faded' ? 'the details are fuzzy' : 'you barely remember'}) ${entry.text}`.replace('- () ', '- ')).join('\n') }],
      },
      isConcurrencySafe: () => false,
      async execute(args, exec) {
        const agent = link()
        const { session, turn, policy } = agent
        return (await session.recallRanked({ characterId, situation: args.about, turn, policy, ...placeOf(session, characterId) }, exec.signal, await vectorOf(agent, args.about, exec.signal))).map(entry => ({ clarity: entry.clarity, turn: entry.turn, text: entry.text }))
      },
    }),
  ]
}
