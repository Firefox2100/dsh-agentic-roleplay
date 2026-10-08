import { defineTool, type ToolDefinition } from '@deepseek-ai/dsh-tools'
import { IMPORTANCE_MAX, IMPORTANCE_MIN, MEMORY_KINDS, PERCEPTION_MODES, ACCURACIES } from 'dsh-roleplay-model'
import { NotFoundError } from '../errors.ts'
import type { MemoryPolicy } from '../memory/recall.ts'
import { characterKey, locationKey, parseRecordsEdit, recordsEditSchema } from '../records/edit.ts'
import { lintWorld } from '../records/lint.ts'
import { describeHolder } from '../records/read.ts'
import { agendaAt } from '../records/agenda.ts'
import { describeValue, shownVariables } from '../records/variables.ts'
import { describeInstant, localIso, minuteText } from '../records/time.ts'
import { itemKey } from '../records/items.ts'
import type { Session } from '../plugin.ts'

/** The roleplay session an agent works in, as the plugin that runs the agent knows it. */
export interface AgentLink {
  session: Pick<Session, 'characters' | 'factions' | 'factionStates' | 'factionMemberships' | 'factionRelationships' | 'factionIntents' | 'lore' | 'events' | 'memories' | 'threads' | 'records' | 'recallRanked' | 'searchEvents' | 'edit' | 'locations' | 'placements' | 'relationships' | 'knowledge' | 'consolidation' | 'planMove' | 'items' | 'slots' | 'variables' | 'intents' | 'routines' | 'engagements' | 'clock'>
  /** The time zone the story's times are written and read in; UTC when not given. */
  timeZone?: string
  /** The turn the agent is playing, which is what the age of a memory is counted from. */
  turn: number
  policy: MemoryPolicy
  /**
   * The vector of a text of the moment, from the model that made the session's stored vectors, so that
   * a search also finds what means the same in other words. `undefined` (or a promise of it) when
   * there is none, and the search then goes by words alone.
   */
  queryVector?: (text: string, signal?: AbortSignal) => Promise<readonly number[] | undefined>
}

/** The vector of a text for a search, or nothing when the agent has no way to make one. */
export async function vectorOf(agent: AgentLink, text: string, signal?: AbortSignal): Promise<{ queryVector: readonly number[] } | Record<string, never>> {
  const vector = await agent.queryVector?.(text, signal)
  return vector === undefined ? {} : { queryVector: vector }
}

/** Finds the session behind an agent, by the id of the agent's own session; `undefined` when it works in none. */
export type AgentResolver = (agentSessionId: string) => AgentLink | undefined

/** The parts of the records `read_records` can be limited to. */
const READ_SECTIONS = ['characters', 'factions', 'faction_relationships', 'events', 'beliefs', 'open_threads', 'items', 'relationships', 'knowledge', 'variable_defs', 'variables', 'engagements']

const MAX_EVENTS = 20
const MAX_LISTED_PLACES = 100
const MAX_LISTED_ITEMS = 60

const link = (resolve: AgentResolver, agent: { session: { id: string } } | undefined): AgentLink => {
  const found = agent === undefined ? undefined : resolve(agent.session.id)
  if (found === undefined) throw new NotFoundError('this agent is not working in a roleplay session, so there are no records to use')
  return found
}

const pretty = (_args: unknown, value: unknown) => [{ type: 'text' as const, text: JSON.stringify(value, null, 2) }]
const summary = (text: string) => (_args: unknown, value: { writes: number }) => [{ type: 'text' as const, text: `${text} (${value.writes} change${value.writes === 1 ? '' : 's'})` }]
const strings = { type: 'array', items: { type: 'string' } } as const
const integers = { type: 'array', items: { type: 'integer' } } as const
/** The members of an output object are all present. */
const str = { type: 'string', required: true } as const
const int = { type: 'integer', required: true } as const
const strs = { ...strings, required: true } as const
const ints = { ...integers, required: true } as const

/**
 * The model-facing tools over a roleplay session. Reading tools show what the story has
 * recorded; writing tools change it and are registered only when the plugin is configured
 * for them. Both resolve the session from the agent that calls them.
 */
export function createTools(resolve: AgentResolver, options: {
  write: boolean
  /** Limits the characters a call may name to these keys, for an agent that works on one story. */
  characters?: readonly string[]
  /** Tools of the agent that makes up characters and places and fits them into the world: it makes them with `edit_world` instead of `edit_records`, and reads what is inconsistent. Never for a global registration. */
  authoring?: boolean
}): ToolDefinition[] {
  const reads = [
    defineTool({
      name: 'search_lore',
      description: 'Search the canonical background lore of the story. Use this when history, culture, geography, institutions, customs or legends matter to the scene. This is game-master knowledge; character agents receive only lore they explicitly know.',
      parameters: { about: { type: 'string', required: true }, limit: { type: 'integer', description: 'Maximum entries, from 1 to 20.' } },
      output: { schema: { type: 'array', items: { type: 'object', additionalProperties: false, properties: { key: str, title: str, kind: str, summary: str, body: str, sources: strs } } }, render: pretty },
      isConcurrencySafe: () => true,
      async execute(args, exec) {
        const { session } = link(resolve, exec.agent); const needle = args.about.trim().toLowerCase(); const limit = Math.max(1, Math.min(20, args.limit ?? 8))
        return session.lore.list().filter(entry => `${entry.title} ${entry.summary} ${entry.body} ${entry.sources.join(' ')}`.toLowerCase().includes(needle)).slice(0, limit).map(entry => ({ key: entry.sourceId ?? String(entry.id), title: entry.title, kind: entry.kind, summary: entry.summary, body: entry.body, sources: entry.sources }))
      },
    }),
    defineTool({
      name: 'list_characters',
      description: 'List the characters of the story with the key each is named by, who controls it and a short summary.',
      parameters: {},
      output: {
        schema: { type: 'array', items: { type: 'object', additionalProperties: false, properties: { key: str, name: str, role: str, controlled_by: str, summary: str } } },
        render: pretty,
      },
      isConcurrencySafe: () => true,
      async execute(_args, exec) {
        const { session } = link(resolve, exec.agent)
        return session.characters.list().map(character => ({ key: characterKey(character), name: character.name, role: character.role, controlled_by: character.control === 'player' ? 'the player' : 'an agent', summary: character.summary }))
      },
    }),
    defineTool({
      name: 'get_character',
      description: 'Read one character: who it is and its current state (what can be seen of it, what it thinks and feels, what it is doing, and what is tracked of it: its feelings and whatever else the story keeps track of).',
      parameters: { character: { type: 'string', required: true, description: 'The key of the character, as list_characters gives it.' } },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            character: str, name: str, aliases: strs, summary: str, personality: str,
            public_state: str, inner_state: str, activity: str, variables: { type: 'json', required: true },
            location: { type: 'json', required: true }, position: str,
            relationships: { type: 'json', required: true },
            carrying: { type: 'json', required: true },
          },
        },
        render: pretty,
      },
      isConcurrencySafe: () => true,
      async execute(args, exec) {
        const { session } = link(resolve, exec.agent)
        const view = session.records().characters.find(entry => entry.character === args.character)
        const found = session.characters.list().find(character => characterKey(character) === args.character)
        if (view === undefined || found === undefined) throw new NotFoundError(`there is no character "${args.character}"; list_characters shows the keys`)
        return { character: view.character, name: view.name, aliases: found.aliases, summary: found.summary, personality: found.personality, public_state: view.public_state, inner_state: view.inner_state, activity: view.activity, variables: shownVariables(session, 'character', found.id, characterKey(found), 'story').map(entry => ({ variable: entry.variable.key, name: entry.variable.name, value: describeValue(entry.variable, entry.value), ...(entry.baseline === undefined ? {} : { baseline: describeValue(entry.variable, entry.baseline) }) })), location: view.location, position: view.position, relationships: session.records().relationships.filter(relation => relation.from === args.character), carrying: session.items.contents({ kind: 'character', id: found.id }).map(({ item, holding }) => ({ key: itemKey(item), name: item.name, quantity: item.quantity, how: holding.holder.kind === 'character' && holding.holder.mode === 'worn' ? `worn on the ${holding.holder.slot}` : 'carried', ...(item.container === undefined ? {} : { state: item.container.state }) })) }
      },
    }),
    defineTool({
      name: 'list_factions',
      description: 'List the persistent organisations of the story. These hold institutional state and strategy; group characters are the actors that appear in scenes.',
      parameters: {},
      output: { schema: { type: 'json' }, render: pretty },
      isConcurrencySafe: () => true,
      async execute(_args, exec) {
        const { session } = link(resolve, exec.agent)
        return session.factions.list().map(faction => ({ key: faction.sourceId ?? String(faction.id), name: faction.name, summary: faction.summary, members: session.factionMemberships.ofFaction(faction.id, 'active').length, active_goals: session.factionIntents.list(faction.id, { status: 'active' }).length }))
      },
    }),
    defineTool({
      name: 'get_faction',
      description: 'Read one faction: its identity, institutional state, active strategy, memberships, and every directional relationship involving it.',
      parameters: { faction: { type: 'string', required: true, description: 'The key of the faction, as list_factions gives it.' } },
      output: { schema: { type: 'json' }, render: pretty },
      isConcurrencySafe: () => true,
      async execute(args, exec) {
        const { session } = link(resolve, exec.agent)
        const faction = session.factions.list().find(entry => (entry.sourceId ?? String(entry.id)) === args.faction)
        if (faction === undefined) throw new NotFoundError(`there is no faction "${args.faction}"; list_factions shows the keys`)
        const records = session.records()
        return { ...records.factions.find(entry => entry.faction === args.faction), relationships: { sees: records.faction_relationships.filter(entry => entry.from_kind === 'faction' && entry.from === args.faction), seen_by: records.faction_relationships.filter(entry => entry.to_kind === 'faction' && entry.to === args.faction) } }
      },
    }),
    defineTool({
      name: 'list_relationships',
      description: 'How characters stand towards each other: for each, the label (what the other is to it), a sentence, and how well it knows, trusts, likes and is strained with the other. Give a character to see how it sees others and how others see it.',
      parameters: { character: { type: 'string', description: 'The key of a character. Leave out for every relationship (the most recently changed first, at most 80).' } },
      output: { schema: { type: 'json' }, render: pretty },
      isConcurrencySafe: () => true,
      async execute(args, exec) {
        const { session } = link(resolve, exec.agent)
        const all = session.records().relationships
        if (args.character === undefined) return JSON.parse(JSON.stringify(all)) as never
        if (!session.characters.list().some(character => characterKey(character) === args.character)) throw new NotFoundError(`there is no character "${args.character}"; list_characters shows the keys`)
        return JSON.parse(JSON.stringify({ sees: all.filter(relation => relation.from === args.character), seenBy: all.filter(relation => relation.to === args.character) })) as never
      },
    }),

    defineTool({
      name: 'list_items',
      description: 'List things, with the key each is named by and where it is. Narrow to what a character has, what is in a place, or what is inside a container; or search by words. At most 60 are listed, notable ones first.',
      parameters: {
        character: { type: 'string', description: 'The key of a character: what it carries and wears.' },
        location: { type: 'string', description: 'The key of a place: what is lying there (not what is inside containers).' },
        container: { type: 'string', description: 'The key of an item: what is inside it, whether it is open or not.' },
        text: { type: 'string', description: 'Only items whose name or description has this.' },
      },
      output: { schema: { type: 'json' }, render: pretty },
      isConcurrencySafe: () => true,
      async execute(args, exec) {
        const { session } = link(resolve, exec.agent)
        const characters = session.characters.list()
        const keyOf = (id: number): string => { const found = characters.find(character => character.id === id); return found === undefined ? String(id) : characterKey(found) }
        const target = { items: session.items, locations: session.locations, characters: session.characters }
        let pool = session.items.list()
        if (args.character !== undefined) {
          const who = characters.find(character => characterKey(character) === args.character)
          if (who === undefined) throw new NotFoundError(`there is no character "${args.character}"; list_characters shows the keys`)
          pool = session.items.contents({ kind: 'character', id: who.id }).map(entry => entry.item)
        } else if (args.location !== undefined) {
          const where = session.locations.list().find(candidate => locationKey(candidate) === args.location)
          if (where === undefined) throw new NotFoundError(`there is no place "${args.location}"; list_locations shows the keys`)
          pool = session.items.contents({ kind: 'location', id: where.id }).map(entry => entry.item)
        } else if (args.container !== undefined) {
          const box = session.items.list().find(candidate => itemKey(candidate) === args.container)
          if (box === undefined) throw new NotFoundError(`there is no item "${args.container}"; list_items shows the keys`)
          pool = session.items.contents({ kind: 'item', id: box.id }).map(entry => entry.item)
        }
        const needle = args.text?.trim().toLowerCase()
        if (needle !== undefined && needle !== '') pool = pool.filter(item => item.name.toLowerCase().includes(needle) || item.description.toLowerCase().includes(needle))
        return JSON.parse(JSON.stringify([...pool].sort((a, b) => Number(b.notable) - Number(a.notable) || a.id - b.id).slice(0, MAX_LISTED_ITEMS).map(item => ({
          key: itemKey(item), name: item.name, quantity: item.quantity, quality: item.quality, state: item.container?.state ?? null, hidden: item.hidden, notable: item.notable, holder: describeHolder(target, item.id, keyOf),
        })))) as never
      },
    }),
    defineTool({
      name: 'get_item',
      description: 'Read one item: what it is, its condition, whose it is, where it is, what is inside it when it is a container, and what opens it. A hidden or closed thing is shown too: this is what the story knows.',
      parameters: { item: { type: 'string', required: true, description: 'The key of the item, as list_items gives it.' } },
      output: { schema: { type: 'json' }, render: pretty },
      isConcurrencySafe: () => true,
      async execute(args, exec) {
        const { session } = link(resolve, exec.agent)
        const found = session.items.list().find(candidate => itemKey(candidate) === args.item)
        if (found === undefined) throw new NotFoundError(`there is no item "${args.item}"; list_items shows the keys`)
        const characters = session.characters.list()
        const keyOf = (id: number): string => { const who = characters.find(character => character.id === id); return who === undefined ? String(id) : characterKey(who) }
        const keys = (ids: readonly number[]): string[] => ids.map(id => { const other = session.items.get(id); return other === undefined ? String(id) : itemKey(other) })
        return JSON.parse(JSON.stringify({
          item: itemKey(found), name: found.name, description: found.description, quantity: found.quantity, unique: found.unique, quality: found.quality, notable: found.notable, hidden: found.hidden,
          wearable: found.wearableSlot ?? null, state: found.container?.state ?? null, owner: found.ownerId === undefined ? null : keyOf(found.ownerId),
          where: describeHolder({ items: session.items, locations: session.locations, characters: session.characters }, found.id, keyOf),
          inside: found.container === undefined ? null : session.items.contents({ kind: 'item', id: found.id }).map(entry => ({ key: itemKey(entry.item), name: entry.item.name, quantity: entry.item.quantity })),
          opened_by: keys(session.items.openers({ kind: 'item', id: found.id })),
        })) as never
      },
    }),
    defineTool({
      name: 'list_slots',
      description: 'The places on the body something can be worn in this world, and how many things fit in each.',
      parameters: {},
      output: { schema: { type: 'array', items: { type: 'object', additionalProperties: false, properties: { id: str, name: str, capacity: int } } }, render: pretty },
      isConcurrencySafe: () => true,
      async execute(_args, exec) {
        return link(resolve, exec.agent).session.slots.list()
      },
    }),
    defineTool({
      name: 'list_locations',
      description: 'List the places of the story with the key each is named by and the place it is in. Narrow to what is inside one place with `within`; at most 100 are listed.',
      parameters: { within: { type: 'string', description: 'The key of a place: list only the places inside it, at any depth.' } },
      output: {
        schema: { type: 'array', items: { type: 'object', additionalProperties: false, properties: { key: str, name: str, in: { type: 'json', required: true }, exits: int } } },
        render: pretty,
      },
      isConcurrencySafe: () => true,
      async execute(args, exec) {
        const { session } = link(resolve, exec.agent)
        const all = session.locations.list()
        const keys = new Map(all.map(place => [place.id, locationKey(place)]))
        const within = args.within === undefined ? undefined : all.find(place => locationKey(place) === args.within)
        if (args.within !== undefined && within === undefined) throw new NotFoundError(`there is no place "${args.within}"; list_locations shows the keys`)
        const inside = (place: (typeof all)[number]): boolean => {
          for (let up = place.parentId; up !== undefined; up = all.find(candidate => candidate.id === up)?.parentId) if (up === within?.id) return true
          return false
        }
        return all.filter(place => within === undefined || inside(place)).slice(0, MAX_LISTED_PLACES).map(place => ({ key: locationKey(place), name: place.name, in: place.parentId === undefined ? null : keys.get(place.parentId) ?? null, exits: session.locations.exitsFrom(place.id).length }))
      },
    }),
    defineTool({
      name: 'get_location',
      description: 'Read one place: what it is like, the things in it that can be pointed at, the ways out (and whether each is open, locked or blocked), and who is there.',
      parameters: { location: { type: 'string', required: true, description: 'The key of the place, as list_locations gives it.' } },
      output: { schema: { type: 'json' }, render: pretty },
      isConcurrencySafe: () => true,
      async execute(args, exec) {
        const { session } = link(resolve, exec.agent)
        const place = session.locations.list().find(candidate => locationKey(candidate) === args.location)
        if (place === undefined) throw new NotFoundError(`there is no place "${args.location}"; list_locations shows the keys`)
        const key = (id: number): string => { const found = session.locations.get(id); return found === undefined ? String(id) : locationKey(found) }
        const people = session.characters.list()
        return JSON.parse(JSON.stringify({
          location: locationKey(place), name: place.name, description: place.description, in: place.parentId === undefined ? null : key(place.parentId),
          features: place.features,
          exits: session.locations.exitsFrom(place.id).map(exit => ({ to: key(exit.toId), name: session.locations.get(exit.toId)?.name, state: exit.state, description: exit.description, note: exit.note, travel_time_seconds: exit.travelSeconds ?? null })),
          items: session.items.contents({ kind: 'location', id: place.id }).map(({ item, holding }) => ({ key: itemKey(item), name: item.name, quantity: item.quantity, ...(item.hidden ? { hidden: true } : {}), ...(item.container === undefined ? {} : { state: item.container.state }), ...(holding.holder.kind === 'location' && holding.holder.position !== undefined ? { position: holding.holder.position } : {}) })),
          here: session.placements.at(place.id, 'character').map(placement => { const who = people.find(character => character.id === placement.entityId); return { character: who === undefined ? String(placement.entityId) : characterKey(who), position: placement.position, feature: placement.featureKey ?? null } }),
        })) as never
      },
    }),

    defineTool({
      name: 'search_events',
      description: 'Look up what objectively happened in the story, in the order it happened. Narrow by character, turns, importance or what it is about.',
      parameters: {
        character: { type: 'string', description: 'Only events this character is involved in.' },
        text: { type: 'string', description: 'Only events about this, found by its words or its meaning; with it, the best matches come first.' },
        location: { type: 'string', description: 'Only events that happened in this place (its key).' },
        item: { type: 'string', description: 'Only events about this item (its key).' },
        from_turn: { type: 'integer' },
        to_turn: { type: 'integer' },
        min_importance: { type: 'integer', description: `From ${IMPORTANCE_MIN} to ${IMPORTANCE_MAX}.` },
        limit: { type: 'integer', description: `At most this many (at most ${MAX_EVENTS}): the most recent, or the best matches when text is given.` },
      },
      output: {
        schema: {
          type: 'array',
          items: { type: 'object', additionalProperties: false, properties: { id: int, turn: int, round: int, text: str, importance: int, tags: strs, involves: strs } },
        },
        render: pretty,
      },
      isConcurrencySafe: () => true,
      async execute(args, exec) {
        const agent = link(resolve, exec.agent)
        const { session } = agent
        const characters = session.characters.list()
        const involving = args.character === undefined ? undefined : characters.find(character => characterKey(character) === args.character)
        if (args.character !== undefined && involving === undefined) throw new NotFoundError(`there is no character "${args.character}"; list_characters shows the keys`)
        const place = args.location === undefined ? undefined : session.locations.list().find(candidate => locationKey(candidate) === args.location)
        if (args.location !== undefined && place === undefined) throw new NotFoundError(`there is no place "${args.location}"; list_locations shows the keys`)
        const thing = args.item === undefined ? undefined : session.items.list().find(candidate => itemKey(candidate) === args.item)
        if (args.item !== undefined && thing === undefined) throw new NotFoundError(`there is no item "${args.item}"; list_items shows the keys`)
        const needle = args.text?.trim().toLowerCase()
        const filter = {
          ...(place === undefined ? {} : { locationId: place.id }),
          ...(thing === undefined ? {} : { aboutItem: thing.id }),
          ...(involving === undefined ? {} : { involving: involving.id }),
          ...(args.from_turn === undefined ? {} : { fromTurn: args.from_turn }),
          ...(args.to_turn === undefined ? {} : { toTurn: args.to_turn }),
          ...(args.min_importance === undefined ? {} : { minImportance: args.min_importance }),
        }
        const listed = session.events.list(filter)
        const limit = Math.min(Math.max(args.limit ?? MAX_EVENTS, 1), MAX_EVENTS)
        const keyOf = (id: number): string => { const owner = characters.find(character => character.id === id); return owner === undefined ? String(id) : characterKey(owner) }
        const shown = (events: readonly (typeof listed)[number][]) => events.map(event => ({
          id: event.id, turn: event.turn, round: event.round, text: event.text, importance: event.importance, tags: event.tags, involves: event.involves.map(keyOf),
        }))
        if (needle === undefined || needle === '') return shown(listed.slice(-limit))
        // What matches the words or the meaning of the text comes first, best first; a plain substring match still counts.
        const { queryVector } = await vectorOf(agent, needle, exec.signal)
        const ranked = session.searchEvents({
          text: needle, limit: 50,
          ...(queryVector === undefined ? {} : { vector: queryVector }),
          ...(filter.fromTurn === undefined ? {} : { fromTurn: filter.fromTurn }),
          ...(filter.toTurn === undefined ? {} : { toTurn: filter.toTurn }),
          ...(filter.minImportance === undefined ? {} : { minImportance: filter.minImportance }),
          ...(filter.locationId === undefined ? {} : { locationId: filter.locationId }),
          ...(filter.aboutItem === undefined ? {} : { itemId: filter.aboutItem }),
        })
        const allowed = new Set(listed.map(event => event.id))
        const first = ranked.filter(event => allowed.has(event.id))
        const rest = listed.filter(event => !first.some(hit => hit.id === event.id) && (event.text.toLowerCase().includes(needle) || event.tags.some(tag => tag.includes(needle))))
        return shown([...first, ...rest].slice(0, limit))
      },
    }),
    defineTool({
      name: 'recall_memories',
      description: 'What a character remembers of a situation, in the way it remembers it: its own version of events and what it believes, with older and less important things faded or gone when the chat has imperfect memory.',
      parameters: {
        character: { type: 'string', required: true, description: 'The key of the character.' },
        situation: { type: 'string', required: true, description: 'What is happening now, which is what reminds the character of things.' },
      },
      output: { schema: { type: 'array', items: { type: 'object', additionalProperties: false, properties: { clarity: str, turn: int, text: str } } }, render: pretty },
      isConcurrencySafe: () => false,
      async execute(args, exec) {
        const agent = link(resolve, exec.agent)
        const { session, turn, policy } = agent
        const found = session.characters.list().find(character => characterKey(character) === args.character)
        if (found === undefined) throw new NotFoundError(`there is no character "${args.character}"; list_characters shows the keys`)
        return (await session.recallRanked({ characterId: found.id, situation: args.situation, turn, policy, ...(session.placements.get('character', found.id) === undefined ? {} : { locationId: session.placements.get('character', found.id)!.locationId }) }, exec.signal, await vectorOf(agent, args.situation, exec.signal))).map(entry => ({ clarity: entry.clarity, turn: entry.turn, text: entry.text }))
      },
    }),
    defineTool({
      name: 'read_records',
      description: 'Read the records as stored: the state of every character, the events of the given rounds (or all) with who took each in and how, the beliefs formed in those turns, and the open threads.',
      parameters: {
        rounds: { type: 'array', items: { type: 'object', additionalProperties: false, properties: { turn: { type: 'integer', required: true }, round: { type: 'integer', required: true } } }, description: 'Only the events and beliefs of these rounds. Leave out for everything.' },
        sections: { type: 'array', items: { type: 'string', enum: READ_SECTIONS }, description: 'Only these parts of the records (the others come back empty); leave out for all. Asking for what you need keeps the answer short.' },
        relationships_since: { type: 'integer', description: 'Of the relationships, only those that changed in this turn or later.' },
      },
      output: { schema: { type: 'json' }, render: pretty },
      isConcurrencySafe: () => true,
      async execute(args, exec) {
        const { session, timeZone } = link(resolve, exec.agent)
        const view = session.records({ ...(args.rounds === undefined ? {} : { rounds: args.rounds }), ...(timeZone === undefined ? {} : { timeZone }), ...(args.sections === undefined ? {} : { only: args.sections as (keyof ReturnType<typeof session.records>)[] }), ...(args.relationships_since === undefined ? {} : { relationshipsSince: args.relationships_since }) })
        return JSON.parse(JSON.stringify(view)) as never
      },
    }),
    defineTool({
      name: 'list_variables',
      description: 'What the story keeps track of: each variable with the key it is changed by, what it is about (every character, item or place, or the whole world), what it measures, its bounds or words, its default, and who can tell its value.',
      parameters: {},
      output: { schema: { type: 'array', items: { type: 'object', additionalProperties: false, properties: { key: str, name: str, description: str, kind: str, subject: str, only: strs, min: { type: 'json', required: true }, max: { type: 'json', required: true }, options: strs, default: { type: 'json', required: true }, visibility: str, baseline: { type: 'boolean', required: true } } } }, render: pretty },
      isConcurrencySafe: () => true,
      async execute(_args, exec) {
        return link(resolve, exec.agent).session.records().variable_defs
      },
    }),
    defineTool({
      name: 'get_agenda',
      description: 'What a character is expected to be doing and to have done: its routine now and next, what it has committed to that is due soon or overdue, what it is after, and its whole day. Times are in the story\'s time zone.',
      parameters: { character: { type: 'string', required: true, description: 'The key of the character.' } },
      output: { schema: { type: 'json' }, render: pretty },
      isConcurrencySafe: () => true,
      async execute(args, exec) {
        const { session, timeZone } = link(resolve, exec.agent)
        const zone = timeZone ?? 'UTC'
        const found = session.characters.list().find(character => characterKey(character) === args.character)
        const state = session.clock.get()
        if (found === undefined) throw new NotFoundError(`there is no character "${args.character}"; list_characters shows the keys`)
        if (state === undefined) throw new NotFoundError('the story has no clock yet')
        const places = new Map(session.locations.list().map(place => [place.id, locationKey(place)]))
        const names = new Map(session.characters.list().map(character => [character.id, characterKey(character)]))
        const agenda = agendaAt(session, found.id, state.now, zone, { horizon: 48 * 3_600_000, engagements: 10, goals: 5 })
        const place = (id: number | undefined) => (id === undefined ? null : places.get(id) ?? null)
        const occurrence = (entry: typeof agenda.now) => (entry === undefined ? null : { activity: entry.window.activity, location: place(entry.window.locationId), from: localIso(entry.startsAt, zone), until: localIso(entry.endsAt, zone), interruptible: entry.window.interruptible })
        return JSON.parse(JSON.stringify({
          now: describeInstant(state.now, zone),
          routine_now: occurrence(agenda.now),
          routine_next: occurrence(agenda.next),
          engagements: agenda.engagements.map(entry => ({ id: entry.engagement.id, title: entry.engagement.title, at: localIso(entry.engagement.at, zone), location: place(entry.engagement.locationId), with: entry.engagement.participants.map(id => names.get(id) ?? String(id)), overdue: entry.overdue })),
          goals: agenda.goals.map(entry => ({ id: entry.intent.id, name: entry.intent.name, type: entry.intent.type, priority: entry.intent.priority, urgency: entry.intent.urgency, deadline: entry.deadlineAt === undefined ? null : localIso(entry.deadlineAt, zone), overdue: entry.overdue, plan: entry.intent.plan })),
          day: session.routines.list(found.id).map(window => ({ days: window.days.length === 0 ? 'every day' : window.days.join(','), from: minuteText(window.start), to: minuteText(window.end), activity: window.activity, location: place(window.locationId), interruptible: window.interruptible })),
        })) as never
      },
    }),
    defineTool({
      name: 'list_threads',
      description: 'List what is still open in the story: promises made, mysteries raised and goals not settled yet.',
      parameters: {},
      output: { schema: { type: 'array', items: { type: 'object', additionalProperties: false, properties: { id: int, text: str, opened_turn: int } } }, render: pretty },
      isConcurrencySafe: () => true,
      async execute(_args, exec) {
        return link(resolve, exec.agent).session.records().open_threads
      },
    }),
  ]
  const authoringReads: ToolDefinition[] = options.authoring !== true ? [] : [
    defineTool({
      name: 'world_lint',
      description: 'What is inconsistent or unfinished in the world\'s places and characters: places no one can reach or leave, characters in no place, names used twice, characters made up and not yet connected to anyone, ways with no way back. An error leaves the world inconsistent and has to be fixed; a warning should be fitted in; an info is only worth knowing.',
      parameters: {},
      output: { schema: { type: 'array', items: { type: 'object', additionalProperties: false, properties: { severity: str, code: str, subject: { type: 'json', required: true }, message: str } } }, render: pretty },
      isConcurrencySafe: () => true,
      async execute(_args, exec) {
        return JSON.parse(JSON.stringify(lintWorld(link(resolve, exec.agent).session))) as never
      },
    }),
    defineTool({
      name: 'list_consolidation',
      description: 'What was made up in play and has not been fitted into the world yet: characters and places, with the turn they were made in and why.',
      parameters: {},
      output: { schema: { type: 'json' }, render: pretty },
      isConcurrencySafe: () => true,
      async execute(_args, exec) {
        const { session } = link(resolve, exec.agent)
        return JSON.parse(JSON.stringify(session.consolidation.pending().map((item) => {
          const subject = item.kind === 'character' ? session.characters.get(item.subjectId) : session.locations.get(item.subjectId)
          return { id: item.id, kind: item.kind, key: subject === undefined ? String(item.subjectId) : item.kind === 'character' ? characterKey(subject as never) : locationKey(subject as never), name: subject?.name ?? '', made_in_turn: item.createdTurn, why: item.note }
        }))) as never
      },
    }),
  ]
  reads.push(...authoringReads)
  if (!options.write) return reads

  const done = { type: 'object', additionalProperties: false, properties: { writes: int, event_ids: ints, belief_ids: ints } } as const
  const written = (result: { writes: number; eventIds: number[]; beliefIds: number[] }) => ({ writes: result.writes, event_ids: result.eventIds, belief_ids: result.beliefIds })
  const perceivedBy = {
    type: 'array',
    description: 'Who took the event in: only characters who could actually have perceived it, each with how and, when it differs from the event, what they took in.',
    items: {
      type: 'object',
      additionalProperties: false,
      properties: {
        character: { type: 'string', required: true },
        mode: { type: 'string', enum: PERCEPTION_MODES },
        content: { type: 'string' },
        gist: { type: 'string' },
        accuracy: { type: 'string', enum: ACCURACIES },
      },
    },
  } as const

  const editSchema = recordsEditSchema({ ...(options.characters === undefined ? {} : { characters: options.characters }), changes: true, ...(options.authoring === true ? { authoring: true } : {}) })
  const writes: ToolDefinition[] = [
    {
      name: options.authoring === true ? 'edit_world' : 'edit_records',
      description: options.authoring === true
        ? 'Make up characters and places and fit them into the world, in one call, together or not at all: new characters (with their state and where they are), new places with their features and ways, new ways between places, relationship profiles between characters (one per direction), changes to places and ways, and corrections. If anything in it is refused, nothing is written and the reasons are returned: correct them and call again.'
        : 'Change the story\'s records in one call, together or not at all: character states, new events (with where they happened and who took them in), corrections and retractions of draft events, revisions of what characters took in, changes to places and the ways between them, how characters stand towards each other, beliefs, and story threads. If anything in it is refused, nothing is written and the reasons are returned: correct them and call again.',
      parameters: editSchema as unknown as Record<string, unknown>,
      output: {
        schema: { type: 'object', properties: { writes: { type: 'integer' }, event_ids: { type: 'array', items: { type: 'integer' } }, belief_ids: { type: 'array', items: { type: 'integer' } }, character_keys: { type: 'array', items: { type: 'string' } }, place_keys: { type: 'array', items: { type: 'string' } }, item_keys: { type: 'array', items: { type: 'string' } }, variable_keys: { type: 'array', items: { type: 'string' } }, trigger_keys: { type: 'array', items: { type: 'string' } } }, required: ['writes', 'event_ids', 'belief_ids', 'character_keys', 'place_keys', 'item_keys', 'variable_keys', 'trigger_keys'], additionalProperties: false },
        render: (_args, value) => summary(options.authoring === true ? 'World changed' : 'Records changed')(_args, value as { writes: number }),
      },
      async execute(args, exec) {
        const { session, timeZone } = link(resolve, exec.agent)
        const result = session.edit({ ...parseRecordsEdit(args), ...(timeZone === undefined ? {} : { timeZone }) })
        return { writes: result.writes, event_ids: result.eventIds, belief_ids: result.beliefIds, character_keys: result.characterKeys ?? [], place_keys: result.placeKeys ?? [], item_keys: result.itemKeys ?? [], variable_keys: result.variableKeys ?? [], trigger_keys: result.triggerKeys ?? [] }
      },
    },
    ...(options.authoring !== true ? [] : [defineTool({
      name: 'resolve_consolidation',
      description: 'Say that something made up in play has been fitted into the world, and how: what you connected it to, or why nothing more is needed. Only after you have done it.',
      parameters: {
        id: { type: 'integer', required: true, description: 'The id list_consolidation gives.' },
        resolution: { type: 'string', required: true, description: 'What was done, in a sentence.' },
      },
      output: { schema: done, render: summary('Fitted in') },
      async execute(args, exec) {
        const { session, turn } = link(resolve, exec.agent)
        if (args.resolution.trim() === '') throw new NotFoundError('say what was done to fit it in')
        session.consolidation.resolve(args.id, turn, args.resolution)
        return { writes: 1, event_ids: [], belief_ids: [] }
      },
    })]),
    defineTool({
      name: 'update_character_state',
      description: 'Change the current state of a character. Give only what changed: public_state is what anyone present can see (a present-tense description, not a log), inner_state is private, activity is what it is doing now.',
      parameters: {
        character: { type: 'string', required: true },
        public_state: { type: 'string' },
        inner_state: { type: 'string' },
        activity: { type: 'string' },
      },
      output: { schema: done, render: summary('State updated') },
      async execute(args, exec) {
        const { session, turn } = link(resolve, exec.agent)
        const { character, public_state, inner_state, activity } = args
        return written(session.edit({
          turn,
          states: [{ character, ...(public_state === undefined ? {} : { publicState: public_state }), ...(inner_state === undefined ? {} : { innerState: inner_state }), ...(activity === undefined ? {} : { activity }) }],
        }))
      },
    }),
    defineTool({
      name: 'move_character',
      description: 'Move a character to another place. It must be possible: there has to be a way over open exits from where it is, unless ignore_exits says the story itself carries it (carried off, teleported, falls). The reasons come back if it is not.',
      parameters: {
        character: { type: 'string', required: true },
        to: { type: 'string', required: true, description: 'The key of the place, as list_locations gives it.' },
        position: { type: 'string', description: 'Where in the place, in words: "at the bar", "by the door".' },
        feature: { type: 'string', description: 'The key of a feature of the place it is at.' },
        ignore_exits: { type: 'boolean' },
      },
      output: { schema: done, render: summary('Moved') },
      async execute(args, exec) {
        const { session, turn } = link(resolve, exec.agent)
        return written(session.edit({ turn, moves: [{ character: args.character, to: args.to, ...(args.position === undefined ? {} : { position: args.position }), ...(args.feature === undefined ? {} : { feature: args.feature }), ...(args.ignore_exits === true ? { ignoreExits: true } : {}) }] }))
      },
    }),
    defineTool({
      name: 'record_event',
      description: 'Record something that objectively happened, as a short factual past-tense statement, and who took it in.',
      parameters: {
        text: { type: 'string', required: true },
        importance: { type: 'integer', required: true, description: `From ${IMPORTANCE_MIN} (a passing detail) to ${IMPORTANCE_MAX} (turns the story).` },
        round: { type: 'integer', description: 'The round of the turn it happened in; 1 by default.' },
        tags: strings,
        involves: { ...strings, description: 'The keys of the characters the event is about.' },
        perceived_by: perceivedBy,
      },
      output: { schema: done, render: summary('Event recorded') },
      async execute(args, exec) {
        const { session, turn } = link(resolve, exec.agent)
        // Written directly, not by a keeper that checks it afterwards: the event is final at once.
        return written(session.edit({
          turn,
          events: [{
            turn, round: args.round ?? 1, text: args.text, importance: args.importance,
            ...(args.tags === undefined ? {} : { tags: args.tags }),
            ...(args.involves === undefined ? {} : { involves: args.involves }),
            perceivedBy: (args.perceived_by ?? []).map(entry => ({ character: entry.character, mode: (entry.mode ?? 'witnessed') as (typeof PERCEPTION_MODES)[number], ...(entry.content === undefined ? {} : { content: entry.content }), ...(entry.gist === undefined ? {} : { gist: entry.gist }), ...(entry.accuracy === undefined ? {} : { accuracy: entry.accuracy as (typeof ACCURACIES)[number] }) })),
          }],
        }, { seal: true }))
      },
    }),
    defineTool({
      name: 'remember',
      description: 'Record something a character has come to believe or know, from that character\'s own point of view.',
      parameters: {
        character: { type: 'string', required: true },
        kind: { type: 'string', required: true, enum: MEMORY_KINDS },
        text: { type: 'string', required: true },
        about: { ...strings, description: 'The keys of the characters it is about.' },
        importance: { type: 'integer', required: true },
      },
      output: { schema: done, render: summary('Remembered') },
      async execute(args, exec) {
        const { session, turn } = link(resolve, exec.agent)
        return written(session.edit({ turn, beliefs: [{ character: args.character, kind: args.kind as (typeof MEMORY_KINDS)[number], text: args.text, importance: args.importance, ...(args.about === undefined ? {} : { about: args.about }) }] }))
      },
    }),
    defineTool({
      name: 'open_thread',
      description: 'Open a story thread: a promise made, a mystery raised or a goal set that is not settled yet.',
      parameters: { text: { type: 'string', required: true, description: 'One sentence.' } },
      output: { schema: done, render: summary('Thread opened') },
      async execute(args, exec) {
        const { session, turn } = link(resolve, exec.agent)
        return written(session.edit({ turn, threadsOpened: [args.text] }))
      },
    }),
    defineTool({
      name: 'resolve_thread',
      description: 'Mark an open story thread as settled.',
      parameters: { id: { type: 'integer', required: true, description: 'The id list_threads gives.' } },
      output: { schema: done, render: summary('Thread resolved') },
      async execute(args, exec) {
        const { session, turn } = link(resolve, exec.agent)
        return written(session.edit({ turn, threadsResolved: [args.id] }))
      },
    }),
  ]
  return [...reads, ...writes]
}
