import { defineTool, type ToolDefinition } from '@deepseek-ai/dsh-tools'
import { IMPORTANCE_MAX, IMPORTANCE_MIN, MEMORY_KINDS, PERCEPTION_MODES, ACCURACIES } from 'dsh-roleplay-model'
import { NotFoundError } from '../errors.ts'
import type { MemoryPolicy } from '../memory/recall.ts'
import { characterKey, parseRecordsEdit, recordsEditSchema } from '../records/edit.ts'
import type { Session } from '../plugin.ts'

/** The roleplay session an agent works in, as the plugin that runs the agent knows it. */
export interface AgentLink {
  session: Pick<Session, 'characters' | 'events' | 'memories' | 'threads' | 'records' | 'recallRanked' | 'edit'>
  /** The turn the agent is playing, which is what the age of a memory is counted from. */
  turn: number
  policy: MemoryPolicy
}

/** Finds the session behind an agent, by the id of the agent's own session; `undefined` when it works in none. */
export type AgentResolver = (agentSessionId: string) => AgentLink | undefined

const MAX_EVENTS = 20

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
export function createTools(resolve: AgentResolver, options: { write: boolean; /** Limits the characters a call may name to these keys, for an agent that works on one story. */ characters?: readonly string[] }): ToolDefinition[] {
  const reads = [
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
      description: 'Read one character: who it is and its current state (what can be seen of it, what it thinks and feels, what it is doing, its emotion).',
      parameters: { character: { type: 'string', required: true, description: 'The key of the character, as list_characters gives it.' } },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            character: str, name: str, aliases: strs, summary: str, personality: str,
            public_state: str, inner_state: str, activity: str, emotion: { type: 'json', required: true },
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
        return { character: view.character, name: view.name, aliases: found.aliases, summary: found.summary, personality: found.personality, public_state: view.public_state, inner_state: view.inner_state, activity: view.activity, emotion: view.emotion }
      },
    }),
    defineTool({
      name: 'search_events',
      description: 'Look up what objectively happened in the story, in the order it happened. Narrow by character, turns, importance or words.',
      parameters: {
        character: { type: 'string', description: 'Only events this character is involved in.' },
        text: { type: 'string', description: 'Only events whose text or tags contain this.' },
        from_turn: { type: 'integer' },
        to_turn: { type: 'integer' },
        min_importance: { type: 'integer', description: `From ${IMPORTANCE_MIN} to ${IMPORTANCE_MAX}.` },
        limit: { type: 'integer', description: `At most this many, the most recent first (at most ${MAX_EVENTS}).` },
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
        const { session } = link(resolve, exec.agent)
        const characters = session.characters.list()
        const involving = args.character === undefined ? undefined : characters.find(character => characterKey(character) === args.character)
        if (args.character !== undefined && involving === undefined) throw new NotFoundError(`there is no character "${args.character}"; list_characters shows the keys`)
        const needle = args.text?.trim().toLowerCase()
        const found = session.events.list({
          ...(involving === undefined ? {} : { involving: involving.id }),
          ...(args.from_turn === undefined ? {} : { fromTurn: args.from_turn }),
          ...(args.to_turn === undefined ? {} : { toTurn: args.to_turn }),
          ...(args.min_importance === undefined ? {} : { minImportance: args.min_importance }),
        }).filter(event => needle === undefined || event.text.toLowerCase().includes(needle) || event.tags.some(tag => tag.includes(needle)))
        const keyOf = (id: number): string => { const owner = characters.find(character => character.id === id); return owner === undefined ? String(id) : characterKey(owner) }
        return found.slice(-Math.min(Math.max(args.limit ?? MAX_EVENTS, 1), MAX_EVENTS)).map(event => ({
          id: event.id, turn: event.turn, round: event.round, text: event.text, importance: event.importance, tags: event.tags, involves: event.involves.map(keyOf),
        }))
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
        const { session, turn, policy } = link(resolve, exec.agent)
        const found = session.characters.list().find(character => characterKey(character) === args.character)
        if (found === undefined) throw new NotFoundError(`there is no character "${args.character}"; list_characters shows the keys`)
        return (await session.recallRanked({ characterId: found.id, situation: args.situation, turn, policy }, exec.signal)).map(entry => ({ clarity: entry.clarity, turn: entry.turn, text: entry.text }))
      },
    }),
    defineTool({
      name: 'read_records',
      description: 'Read the records as stored: the state of every character, the events of the given rounds (or all) with who took each in and how, the beliefs formed in those turns, and the open threads.',
      parameters: { rounds: { type: 'array', items: { type: 'object', additionalProperties: false, properties: { turn: { type: 'integer', required: true }, round: { type: 'integer', required: true } } }, description: 'Only the events and beliefs of these rounds. Leave out for everything.' } },
      output: { schema: { type: 'json' }, render: pretty },
      isConcurrencySafe: () => true,
      async execute(args, exec) {
        const { session } = link(resolve, exec.agent)
        const view = session.records(args.rounds === undefined ? {} : { rounds: args.rounds })
        return JSON.parse(JSON.stringify(view)) as never
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

  const editSchema = recordsEditSchema({ ...(options.characters === undefined ? {} : { characters: options.characters }), changes: true })
  const writes: ToolDefinition[] = [
    {
      name: 'edit_records',
      description: 'Change the story\'s records in one call, together or not at all: character states, new events with who took them in, corrections and retractions of events, beliefs, and story threads. If anything in it is refused, nothing is written and the reasons are returned: correct them and call again.',
      parameters: editSchema as unknown as Record<string, unknown>,
      output: {
        schema: { type: 'object', properties: { writes: { type: 'integer' }, event_ids: { type: 'array', items: { type: 'integer' } }, belief_ids: { type: 'array', items: { type: 'integer' } } }, required: ['writes', 'event_ids', 'belief_ids'], additionalProperties: false },
        render: (_args, value) => summary('Records changed')(_args, value as { writes: number }),
      },
      async execute(args, exec) {
        const { session } = link(resolve, exec.agent)
        const result = session.edit(parseRecordsEdit(args))
        return { writes: result.writes, event_ids: result.eventIds, belief_ids: result.beliefIds }
      },
    },
    defineTool({
      name: 'update_character_state',
      description: 'Change the current state of a character. Give only what changed: public_state is what anyone present can see (a present-tense description, not a log), inner_state is private, activity is what it is doing now.',
      parameters: {
        character: { type: 'string', required: true },
        public_state: { type: 'string' },
        inner_state: { type: 'string' },
        activity: { type: 'string' },
        emotion: { type: 'object', additionalProperties: false, properties: { valence: { type: 'number', required: true }, arousal: { type: 'number', required: true }, dominance: { type: 'number', required: true } } },
      },
      output: { schema: done, render: summary('State updated') },
      async execute(args, exec) {
        const { session, turn } = link(resolve, exec.agent)
        const { character, public_state, inner_state, activity, emotion } = args
        return written(session.edit({
          turn,
          states: [{ character, ...(public_state === undefined ? {} : { publicState: public_state }), ...(inner_state === undefined ? {} : { innerState: inner_state }), ...(activity === undefined ? {} : { activity }), ...(emotion === undefined ? {} : { emotion }) }],
        }))
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
        return written(session.edit({
          turn,
          events: [{
            turn, round: args.round ?? 1, text: args.text, importance: args.importance,
            ...(args.tags === undefined ? {} : { tags: args.tags }),
            ...(args.involves === undefined ? {} : { involves: args.involves }),
            perceivedBy: (args.perceived_by ?? []).map(entry => ({ character: entry.character, mode: (entry.mode ?? 'witnessed') as (typeof PERCEPTION_MODES)[number], ...(entry.content === undefined ? {} : { content: entry.content }), ...(entry.gist === undefined ? {} : { gist: entry.gist }), ...(entry.accuracy === undefined ? {} : { accuracy: entry.accuracy as (typeof ACCURACIES)[number] }) })),
          }],
        }))
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
