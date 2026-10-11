import { defineTool, type PreToolDecision, type ToolDefinition, type ToolExecution } from '@deepseek-ai/dsh-tools'
import { authoredWorldOf } from '../../shared/authoring-chat.ts'
import { InvalidEditProblems, parseRelationEdit } from '../../shared/world-state.ts'
import { editWorldPlots, editWorldRelation, readWorldEditor } from '../worlds/world-editor.ts'
import { parsePlotsFile } from '../plots/load.ts'
import { formatIssue } from '../validation.ts'
import { AUTHORED_ENTITY_KINDS, createAuthoredEntity, deleteAuthoredEntity, readAuthoredEntityDocument, replaceAuthoredEntity, type AuthoredEntityKind } from './documents.ts'
import type { AuthoredWorldReader } from './read-tools.ts'

const output = (value: unknown) => [{ type: 'text' as const, text: JSON.stringify(value, null, 2) }]
const jsonOutput = { schema: { type: 'json' as const }, render: (_args: unknown, value: unknown) => output(value) }
const kindParameter = { type: 'string' as const, required: true as const, enum: AUTHORED_ENTITY_KINDS }
const keyParameter = { type: 'string' as const, required: true as const, description: 'Stable entity key.' }

export const AUTHORING_MUTATION_TOOLS = new Set(['create_world_element', 'replace_world_element', 'delete_world_element', 'edit_world_relationship', 'replace_world_plots'])

function result(action: string, kind: string, key: string, state: Awaited<ReturnType<typeof readWorldEditor>>, extra: Record<string, unknown> = {}): unknown {
  return { action, kind, key, counts: { characters: state.characters.length, locations: state.places.length, items: state.things.length, factions: state.factions.length, lore: state.lore?.length ?? 0, plots: state.plots.length, relationships: state.relations.length }, ...extra }
}

function plotDocument(value: unknown) {
  const parsed = parsePlotsFile(JSON.stringify([value]))
  if (!parsed.ok) throw new InvalidEditProblems(parsed.issues.map(formatIssue))
  return parsed.value[0]!
}

export function authoredWorldWriteTools(reader: AuthoredWorldReader): ToolDefinition[] {
  return [
    defineTool({
      name: 'create_world_element',
      description: 'Create a character, location, item, faction or lore entry from a complete authored JSON document. The key becomes its stable id. Requires user approval.',
      parameters: { kind: kindParameter, key: keyParameter, document: { type: 'json', required: true, description: 'Complete snake_case document in the world file format.' } },
      output: jsonOutput,
      async execute(args, exec) {
        const { record } = await reader.read(exec)
        const world = { id: record.summary.id, directory: record.directory }
        await createAuthoredEntity(world, args.kind as AuthoredEntityKind, args.key, args.document)
        return result('created', args.kind, args.key, await readWorldEditor(world)) as never
      },
    }),
    defineTool({
      name: 'replace_world_element',
      description: 'Update a character, location, item, faction or lore entry by replacing its complete authored JSON document. Read its source first. The stable id cannot be changed. Requires user approval.',
      parameters: { kind: kindParameter, key: keyParameter, document: { type: 'json', required: true, description: 'Complete replacement snake_case document in the world file format.' } },
      output: jsonOutput,
      async execute(args, exec) {
        const { record } = await reader.read(exec)
        const world = { id: record.summary.id, directory: record.directory }
        await replaceAuthoredEntity(world, args.kind as AuthoredEntityKind, args.key, args.document)
        return result('replaced', args.kind, args.key, await readWorldEditor(world)) as never
      },
    }),
    defineTool({
      name: 'delete_world_element',
      description: 'Delete a character, location, item, faction or lore entry. The folder is moved into the world’s .trash directory so it can be recovered. Requires user approval.',
      parameters: { kind: kindParameter, key: keyParameter },
      output: jsonOutput,
      async execute(args, exec) {
        const { record } = await reader.read(exec)
        const world = { id: record.summary.id, directory: record.directory }
        const recoveredFrom = await deleteAuthoredEntity(world, args.kind as AuthoredEntityKind, args.key)
        return result('deleted', args.kind, args.key, await readWorldEditor(world), { recoverable: true, trashPath: recoveredFrom }) as never
      },
    }),
    defineTool({
      name: 'edit_world_relationship',
      description: 'Create, update or remove one authored character relationship, knowledge edge, faction membership, faction social tie or map exit. To create: {"create": true, "kind", "from", "to", and the fields the kind needs (label for character and social, role for membership, description for exit, toKind for knowledge)}, with no key. To change: {"kind", "key", the fields to change}, the key copied exactly from list_relationships. To remove: {"kind", "key", "remove": true}. Requires user approval.',
      parameters: { change: { type: 'json', required: true, description: 'Relationship change accepted by the world editor.' } },
      output: jsonOutput,
      async execute(args, exec) {
        const { record } = await reader.read(exec)
        const world = { id: record.summary.id, directory: record.directory }
        const change = parseRelationEdit(args.change)
        const state = await editWorldRelation(world, change)
        return result('edited', 'relationship', 'key' in change ? change.key : `${change.from}->${change.to}`, state) as never
      },
    }),
    defineTool({
      name: 'replace_world_plots',
      description: 'Replace the complete authored plot list. Use list_plots first; this operation creates, updates and deletes plots together. Requires user approval.',
      parameters: { plots: { type: 'array', required: true, items: { type: 'json' }, description: 'Complete plot documents in the authored snake_case format.' } },
      output: jsonOutput,
      async execute(args, exec) {
        const { record } = await reader.read(exec)
        const world = { id: record.summary.id, directory: record.directory }
        const state = await editWorldPlots(world, { plots: args.plots.map(plotDocument) })
        return result('replaced', 'plots', '*', state) as never
      },
    }),
  ]
}

/**
 * Every change to the world files is put to the person, except in the turn that has just imported a card into the world: it reviews and corrects what it made.
 * @param reviewing - whether the authoring chat is in such a turn.
 */
export async function authoringApproval(exec: ToolExecution, next: () => Promise<PreToolDecision>, reviewing: (chat: string) => Promise<boolean> = () => Promise.resolve(false)): Promise<PreToolDecision> {
  if (!AUTHORING_MUTATION_TOOLS.has(exec.name) || exec.agent === undefined || authoredWorldOf(exec.agent.session.id) === undefined) return await next()
  if (await reviewing(exec.agent.session.id)) return await next()
  const args = exec.arguments as Record<string, unknown>
  const kind = typeof args['kind'] === 'string' ? args['kind'] : exec.name === 'edit_world_relationship' ? 'relationship' : 'plots'
  const key = typeof args['key'] === 'string' ? args['key'] : ''
  const target = key === '' ? kind : `${kind} “${key}”`
  const action = exec.name.startsWith('create') ? 'Create' : exec.name.startsWith('delete') ? 'Delete' : 'Edit'
  return {
    kind: 'ask',
    reason: `${action.toLowerCase()} authored world ${target}`,
    displayReason: { en: `${action} ${target} in the world files?`, zh: `${action === 'Create' ? '创建' : action === 'Delete' ? '删除' : '编辑'}世界文件中的${target}？` },
  }
}

export { readAuthoredEntityDocument }
