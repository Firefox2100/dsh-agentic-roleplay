import { defineTool, type ToolDefinition } from '@deepseek-ai/dsh-tools'
import type { CharacterId } from 'dsh-roleplay-model'
import { vectorOf, type AgentLink } from './index.ts'
import { characterKey, locationKey } from '../records/edit-types.ts'
import { itemKey } from '../records/items.ts'

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
    defineTool({
      name: 'recall_my_known_entities',
      description: 'Recall the people, places, things and routes you know exist. This says only that you know them, not where they are now or their current state.',
      parameters: { about: { type: 'string', description: 'Optional name or word to narrow the result.' } },
      output: { schema: { type: 'array', items: { type: 'object', additionalProperties: false, properties: { kind: { type: 'string', required: true }, key: { type: 'string', required: true }, name: { type: 'string', required: true } } } }, render: (_args, value) => [{ type: 'text', text: value.length === 0 ? 'You know of nothing matching that.' : value.map(entry => `- ${entry.kind}: ${entry.name} (${entry.key})`).join('\n') }] },
      isConcurrencySafe: () => true,
      async execute(args) {
        const { session } = link()
        const found = [
          ...session.relationships.from(characterId).flatMap(relation => { const character = session.characters.get(relation.toId); return character === undefined ? [] : [{ kind: 'character', key: characterKey(character), name: character.name }] }),
          ...session.factionRelationships.from('character', characterId).filter(relation => relation.toKind === 'faction').flatMap(relation => { const faction = session.factions.get(relation.toId); return faction === undefined ? [] : [{ kind: 'faction', key: faction.sourceId ?? String(faction.id), name: faction.name }] }),
          ...session.knowledge.list(characterId, 'location').flatMap(entry => { const place = session.locations.get(entry.subjectId); return place === undefined ? [] : [{ kind: 'location', key: locationKey(place), name: place.name }] }),
          ...session.knowledge.list(characterId, 'item').flatMap(entry => { const item = session.items.get(entry.subjectId); return item === undefined ? [] : [{ kind: 'item', key: itemKey(item), name: item.name }] }),
          ...session.knowledge.list(characterId, 'exit').flatMap(entry => { const exit = session.locations.allExits().find(candidate => candidate.id === entry.subjectId); const from = exit === undefined ? undefined : session.locations.get(exit.fromId); const to = exit === undefined ? undefined : session.locations.get(exit.toId); return from === undefined || to === undefined ? [] : [{ kind: 'route', key: `${locationKey(from)} -> ${locationKey(to)}`, name: `${from.name} to ${to.name}` }] }),
        ]
        const needle = args.about?.trim().toLowerCase()
        return needle === undefined || needle === '' ? found : found.filter(entry => `${entry.key} ${entry.name}`.toLowerCase().includes(needle))
      },
    }),
    defineTool({
      name: 'recall_my_lore',
      description: 'Recall established lore that you know: history, customs, legends, places and other background knowledge. Unknown lore is never returned.',
      parameters: { about: { type: 'string', required: true, description: 'A name, subject or phrase to look for in what you know.' } },
      output: { schema: { type: 'array', items: { type: 'object', additionalProperties: false, properties: { key: { type: 'string', required: true }, title: { type: 'string', required: true }, kind: { type: 'string', required: true }, text: { type: 'string', required: true } } } }, render: (_args, value) => [{ type: 'text', text: value.length === 0 ? 'You do not know any lore matching that.' : value.map(entry => `- ${entry.title} [${entry.kind}] (${entry.key}): ${entry.text}`).join('\n') }] },
      isConcurrencySafe: () => true,
      async execute(args) {
        const needle = args.about.trim().toLowerCase()
        return link().session.knowledge.list(characterId, 'lore').flatMap(known => {
          const lore = link().session.lore.get(known.subjectId)
          if (lore === undefined || !`${lore.title} ${lore.summary} ${lore.body}`.toLowerCase().includes(needle)) return []
          return [{ key: lore.sourceId ?? String(lore.id), title: lore.title, kind: lore.kind, text: lore.body || lore.summary }]
        })
      },
    }),
  ]
}
