import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { defineTool, type ToolDefinition } from '@deepseek-ai/dsh-tools'
import { authoredWorldOf } from '../../shared/authoring-chat.ts'
import type { WorldState } from '../../shared/world-state.ts'
import type { WorldCatalog } from '../worlds/catalog.ts'
import { readWorldEditor } from '../worlds/world-editor.ts'
import { readTriggerDocuments } from '../triggers/files.ts'
import { readWorldInfo } from '../worlds/world-info.ts'
import { AUTHORED_ENTITY_KINDS, readAuthoredEntityDocument, type AuthoredEntityKind } from './documents.ts'

type AgentExec = { agent?: { session: { id: string } } }
type Entity = { key: string; name?: string; title?: string }

const output = (value: unknown) => [{ type: 'text' as const, text: JSON.stringify(value, null, 2) }]
const jsonOutput = { schema: { type: 'json' as const }, render: (_args: unknown, value: unknown) => output(value) }
const keyParameter = { type: 'string' as const, required: true as const, description: 'Stable key shown by the corresponding list tool.' }
const json = (value: unknown): never => JSON.parse(JSON.stringify(value)) as never

export interface AuthoredWorldSnapshot {
  record: Awaited<ReturnType<WorldCatalog['find']>> & {}
  state: WorldState
}

/** Resolves every call from its authoring chat identity, then reads the files afresh. */
export class AuthoredWorldReader {
  constructor(private readonly worlds: WorldCatalog) {}

  async read(exec: AgentExec): Promise<AuthoredWorldSnapshot> {
    const chat = exec.agent?.session.id
    const worldId = chat === undefined ? undefined : authoredWorldOf(chat)
    if (worldId === undefined) throw new Error('this tool is available only in a world authoring chat')
    const record = await this.worlds.find(worldId)
    if (record === undefined) throw new Error(`the authored world "${worldId}" no longer exists`)
    return { record, state: await readWorldEditor({ id: record.summary.id, directory: record.directory }) }
  }

  /** Lists the worlds again: the summaries (description, tags) come from `world.json`. */
  async refresh(): Promise<void> {
    await this.worlds.list({ refresh: true })
  }
}

function listTool<T extends Entity>(reader: AuthoredWorldReader, name: string, description: string, select: (world: WorldState) => readonly T[], summarize: (entry: T) => unknown): ToolDefinition {
  return defineTool({
    name,
    description,
    parameters: {},
    output: jsonOutput,
    isConcurrencySafe: () => true,
    async execute(_args, exec) {
      return json(select((await reader.read(exec)).state).map(summarize))
    },
  })
}

function getTool<T extends Entity>(reader: AuthoredWorldReader, name: string, description: string, select: (world: WorldState) => readonly T[]): ToolDefinition {
  return defineTool({
    name,
    description,
    parameters: { key: keyParameter },
    output: jsonOutput,
    isConcurrencySafe: () => true,
    async execute(args, exec) {
      const found = select((await reader.read(exec)).state).find(entry => entry.key === args.key)
      if (found === undefined) throw new Error(`there is no ${name.slice(4).replaceAll('_', ' ')} with key "${args.key}"`)
      return json(found)
    },
  })
}

/** Read-only tools over authored JSON. No tool in this set writes a file. */
export function authoredWorldReadTools(reader: AuthoredWorldReader): ToolDefinition[] {
  return [
    defineTool({
      name: 'get_world_overview',
      description: 'Read the authored world’s top-level identity, description, rules, opening, tags, author and element counts.',
      parameters: {},
      output: jsonOutput,
      isConcurrencySafe: () => true,
      async execute(_args, exec) {
        const { record, state } = await reader.read(exec)
        const document = JSON.parse(await readFile(join(record.directory, 'world.json'), 'utf8')) as Record<string, unknown>
        return json({
          id: record.summary.id,
          name: record.summary.name,
          description: record.summary.description,
          author: record.summary.author,
          tags: record.summary.tags,
          rules: document['rules'] ?? [],
          opening_message: document['opening_message'],
          counts: { characters: state.characters.length, locations: state.places.length, items: state.things.length, factions: state.factions.length, lore: state.lore?.length ?? 0, plots: state.plots.length, relationships: state.relations.length },
        })
      },
    }),
    defineTool({
      name: 'get_world_info',
      description: 'Read what the world says about itself in world.json: name, description, tags, rules, the opening message and the alternate openings, author, version, time settings, and the preset, lorebooks, sampling and tool switches the person chose. edit_world_info changes the fields a card or an author is responsible for.',
      parameters: {},
      output: jsonOutput,
      isConcurrencySafe: () => true,
      async execute(_args, exec) {
        return json(await readWorldInfo((await reader.read(exec)).record.directory))
      },
    }),
    listTool(reader, 'list_characters', 'List authored characters with stable keys and concise identifying information.', world => world.characters, entry => ({ key: entry.key, name: entry.name, aliases: entry.aliases, role: entry.role, tier: entry.tier, kind: entry.kind, summary: entry.summary, place: entry.place })),
    getTool(reader, 'get_character', 'Read every authored detail of one character, including starting state, goals, voice and visual identity.', world => world.characters),
    listTool(reader, 'list_locations', 'List authored locations with stable keys, parents and descriptions.', world => world.places, entry => ({ key: entry.key, name: entry.name, parent: entry.parent, description: entry.description })),
    getTool(reader, 'get_location', 'Read every authored detail of one location, including features and visual identity.', world => world.places),
    listTool(reader, 'list_items', 'List authored items with stable keys, holders and concise descriptions.', world => world.things, entry => ({ key: entry.key, name: entry.name, holder: entry.holder, owner: entry.owner, quantity: entry.quantity, notable: entry.notable, description: entry.description })),
    getTool(reader, 'get_item', 'Read every authored detail of one item, including storage, container and visual properties.', world => world.things),
    listTool(reader, 'list_factions', 'List authored factions with stable keys, summaries and member counts.', world => world.factions, entry => ({ key: entry.key, name: entry.name, aliases: entry.aliases, summary: entry.summary, members: entry.members.length })),
    getTool(reader, 'get_faction', 'Read every authored detail of one faction, including members, goals, values and relationships.', world => world.factions),
    listTool(reader, 'list_lore', 'List authored lore entries with stable keys, kinds, summaries and linked subjects.', world => world.lore ?? [], entry => ({ key: entry.key, title: entry.title, kind: entry.kind, summary: entry.summary, subjects: entry.subjects })),
    getTool(reader, 'get_lore', 'Read the full body and links of one authored lore entry.', world => world.lore ?? []),
    defineTool({
      name: 'get_world_element_source',
      description: 'Read the exact snake_case JSON document stored for a character, location, item, faction or lore entry. Use this before replacing an element.',
      parameters: { kind: { type: 'string', required: true, enum: AUTHORED_ENTITY_KINDS }, key: keyParameter },
      output: jsonOutput,
      isConcurrencySafe: () => true,
      async execute(args, exec) {
        const { record } = await reader.read(exec)
        return json(await readAuthoredEntityDocument({ id: record.summary.id, directory: record.directory }, args.kind as AuthoredEntityKind, args.key))
      },
    }),
    listTool(reader, 'list_plots', 'List authored plot scaffolds with stable keys, premises, status and pressure.', world => world.plots.map(entry => ({ ...entry.definition, key: entry.definition.id, name: entry.definition.name })), entry => entry),
    getTool(reader, 'get_plot', 'Read one complete authored plot scaffold.', world => world.plots.map(entry => ({ ...entry.definition, key: entry.definition.id, name: entry.definition.name }))),
    listTool(reader, 'list_world_triggers', 'List the world’s triggers (what the world does by itself): key, name, what each waits for (when), the kinds of its effects, whether it repeats, and what it names that the world does not have (problems).', world => (world.triggers ?? []).map(entry => ({ ...entry, name: entry.name })), entry => ({ key: entry.key, name: entry.name, when: entry.when, effects: entry.effects.map(effect => effect.type), repeat: entry.repeat, priority: entry.priority, announced: entry.announced, problems: entry.problems })),
    defineTool({
      name: 'get_world_trigger',
      description: 'Read the exact snake_case JSON document stored for one trigger in triggers.json. Use this before replacing a trigger.',
      parameters: { key: keyParameter },
      output: jsonOutput,
      isConcurrencySafe: () => true,
      async execute(args, exec) {
        const { record } = await reader.read(exec)
        const found = (await readTriggerDocuments(record.directory)).find(entry => entry['key'] === args.key)
        if (found === undefined) throw new Error(`there is no trigger with key "${args.key}"`)
        return json(found)
      },
    }),
    defineTool({
      name: 'list_relationships',
      description: 'Read authored character relationships, knowledge, faction memberships, social ties and map exits. Optionally narrow by kind or endpoint key.',
      parameters: {
        kind: { type: 'string', enum: ['character', 'knowledge', 'membership', 'social', 'exit'] },
        from: { type: 'string', description: 'Only edges whose source has this stable key.' },
        to: { type: 'string', description: 'Only edges whose target has this stable key.' },
      },
      output: jsonOutput,
      isConcurrencySafe: () => true,
      async execute(args, exec) {
        return json((await reader.read(exec)).state.relations.filter(relation =>
          (args.kind === undefined || relation.kind === args.kind)
          && (args.from === undefined || relation.from.key === args.from)
          && (args.to === undefined || relation.to.key === args.to)))
      },
    }),
  ]
}
