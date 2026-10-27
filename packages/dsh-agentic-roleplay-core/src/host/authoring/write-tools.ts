import { defineTool, type PreToolDecision, type ToolDefinition, type ToolExecution } from '@deepseek-ai/dsh-tools'
import { authoredWorldOf } from '../../shared/authoring-chat.ts'
import { InvalidEditProblems, parseRelationEdit } from '../../shared/world-state.ts'
import { editWorldPlots, editWorldRelation, readWorldEditor } from '../worlds/world-editor.ts'
import { parsePlotsFile } from '../plots/load.ts'
import { deleteTriggerDocument, writeTriggerDocument } from '../triggers/files.ts'
import { loadWorldParts } from '../triggers/parts.ts'
import { formatIssue } from '../validation.ts'
import { AUTHORED_ENTITY_KINDS, createAuthoredEntity, deleteAuthoredEntity, readAuthoredEntityDocument, replaceAuthoredEntity, type AuthoredEntityKind } from './documents.ts'
import type { AuthoredWorldReader } from './read-tools.ts'
import { PACK_MUTATION_TOOLS } from './pack-tools.ts'
import { PROMPT_MUTATION_TOOLS, PROSE_PROMPTS } from './prompt-tools.ts'
import { changedFields, createdFields, plain, sizeOf, type Summary } from './approval-summary.ts'

const output = (value: unknown) => [{ type: 'text' as const, text: JSON.stringify(value, null, 2) }]
const jsonOutput = { schema: { type: 'json' as const }, render: (_args: unknown, value: unknown) => output(value) }
const kindParameter = { type: 'string' as const, required: true as const, enum: AUTHORED_ENTITY_KINDS }
const keyParameter = { type: 'string' as const, required: true as const, description: 'Stable entity key.' }

export const AUTHORING_MUTATION_TOOLS = new Set(['import_preset', 'create_world_element', 'replace_world_element', 'delete_world_element', 'edit_world_relationship', 'replace_world_plots', 'write_world_trigger', 'delete_world_trigger', ...PROMPT_MUTATION_TOOLS, ...PACK_MUTATION_TOOLS])

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
    defineTool({
      name: 'write_world_trigger',
      description: 'Create or replace one trigger (something the world does by itself) in triggers.json, from a complete document in the file format, by its key. It is read as a story start reads it and refused, with every problem, when it is malformed or names a character, place, item, variable or trigger the world does not have; read get_world_trigger first when replacing. Requires user approval.',
      parameters: { key: keyParameter, document: { type: 'json', required: true, description: 'Complete snake_case trigger: name, when (condition), effects (one to six: edit, beat, cue), and optionally repeat, cooldown_seconds, chance, priority, expires, announce. A beat or cue may have a while condition and names such as {where:character}.' } },
      output: jsonOutput,
      async execute(args, exec) {
        const { record } = await reader.read(exec)
        const action = await writeTriggerDocument(record.directory, await loadWorldParts(record.directory), args.key, args.document)
        return result(action, 'trigger', args.key, await readWorldEditor({ id: record.summary.id, directory: record.directory })) as never
      },
    }),
    defineTool({
      name: 'delete_world_trigger',
      description: 'Remove one trigger from triggers.json. Its document is kept in the world’s .trash/triggers so it can be put back. A trigger that others wait for cannot be removed. Requires user approval.',
      parameters: { key: keyParameter },
      output: jsonOutput,
      async execute(args, exec) {
        const { record } = await reader.read(exec)
        const kept = await deleteTriggerDocument(record.directory, args.key)
        return result('deleted', 'trigger', args.key, await readWorldEditor({ id: record.summary.id, directory: record.directory }), { recoverable: true, trashPath: kept }) as never
      },
    }),
  ]
}

/**
 * Every change to the world files is put to the person, except in the turn that has just imported a card into the world: it reviews and corrects what it made.
 * @param reviewing - whether the authoring chat is in such a turn.
 * @param options - `auto` is whether the person chose to have changes made without asking; `current` reads the document a replacement is about to replace, so the question can show what changes.
 */
export async function authoringApproval(exec: ToolExecution, next: () => Promise<PreToolDecision>, reviewing: (chat: string) => Promise<boolean> = () => Promise.resolve(false), options: { auto?: () => boolean; current?: (chat: string, kind: AuthoredEntityKind, key: string) => Promise<unknown> } = {}): Promise<PreToolDecision> {
  if (!AUTHORING_MUTATION_TOOLS.has(exec.name) || exec.agent === undefined || authoredWorldOf(exec.agent.session.id) === undefined) return await next()
  const args = exec.arguments as Record<string, unknown>
  const auto = options.auto?.() === true
  if (exec.name === 'import_preset' && exec.agent !== undefined && !auto) {
    return {
      kind: 'ask',
      reason: 'replace the authored world\'s narration and character-style prompts with ones made from the uploaded preset',
      displayReason: { en: 'Replace the world\'s narration and character-style prompts with ones made from the uploaded preset?', zh: '用上传的预设生成的提示词，替换世界的叙述与角色风格提示词？' },
    }
  }
  const prompt = (PROMPT_MUTATION_TOOLS as readonly string[]).includes(exec.name)
  const pack = (PACK_MUTATION_TOOLS as readonly string[]).includes(exec.name)
  const importing = await reviewing(exec.agent.session.id)
  if (importing && pack) return { kind: 'deny', reason: 'an import does not write interface packs; they are left to the person' }
  // The import may set the prose and the persona; the rules of the game are the person's to change.
  if (importing && prompt && !PROSE_PROMPTS.includes(String(args['id']))) return { kind: 'deny', reason: `an import may change only the prose prompts (${PROSE_PROMPTS.join(', ')}); "${String(args['id'])}" holds rules of the game and is left to the person` }
  if (importing || auto) return await next()
  if (pack) {
    const target = `file “${String(args['path'])}” of interface pack “${String(args['pack'])}”`
    const remove = exec.name.startsWith('delete')
    return {
      kind: 'ask',
      reason: `${remove ? 'delete' : 'write'} authored world ${target}`,
      displayReason: { en: `${remove ? 'Delete' : 'Write'} ${target} in the world files?`, zh: `${remove ? '删除' : '写入'}世界文件中界面包“${String(args['pack'])}”的文件“${String(args['path'])}”？` },
    }
  }
  if (prompt) {
    const target = `prompt “${String(args['language'])}/${String(args['id'])}”`
    const remove = exec.name.startsWith('delete')
    return {
      kind: 'ask',
      reason: `${remove ? 'delete' : 'write'} authored world ${target}`,
      displayReason: withDetail({ en: `${remove ? 'Delete' : 'Write'} ${target} in the world files`, zh: `${remove ? '删除' : '写入'}世界文件中的${target}` }, remove ? undefined : sizeOf(args['text'])),
    }
  }
  const kind = typeof args['kind'] === 'string' ? args['kind'] : exec.name === 'edit_world_relationship' ? 'relationship' : exec.name.endsWith('trigger') ? 'trigger' : 'plots'
  const key = typeof args['key'] === 'string' ? args['key'] : ''
  const target = key === '' ? kind : `${kind} “${key}”`
  const action = exec.name.startsWith('create') ? 'Create' : exec.name.startsWith('delete') ? 'Delete' : exec.name === 'write_world_trigger' ? 'Write' : 'Edit'
  const detail = await detailOf(exec, kind, key, options.current).catch(() => undefined)
  return {
    kind: 'ask',
    reason: `${action.toLowerCase()} authored world ${target}`,
    displayReason: withDetail({ en: `${action} ${target} in the world files`, zh: `${action === 'Create' ? '创建' : action === 'Delete' ? '删除' : action === 'Write' ? '写入' : '编辑'}世界文件中的${target}` }, detail),
  }
}

function withDetail(headline: Summary, detail: Summary | undefined): Summary {
  return detail === undefined || detail.en === '' ? { en: `${headline.en}?`, zh: `${headline.zh}？` } : { en: `${headline.en}: ${detail.en}`, zh: `${headline.zh}：${detail.zh}` }
}

/** What the change is, in a line the approval shows: the question is only useful if it says what is being decided. */
async function detailOf(exec: ToolExecution, kind: string, key: string, current: ((chat: string, kind: AuthoredEntityKind, key: string) => Promise<unknown>) | undefined): Promise<Summary | undefined> {
  const args = exec.arguments as Record<string, unknown>
  switch (exec.name) {
    case 'create_world_element': return createdFields(args['document'])
    case 'replace_world_element': {
      const before = exec.agent === undefined ? undefined : await current?.(exec.agent.session.id, kind as AuthoredEntityKind, key)
      return before === undefined ? createdFields(args['document']) : changedFields(before, args['document'])
    }
    case 'edit_world_relationship': return plain(args['change'])
    case 'replace_world_plots': return Array.isArray(args['plots']) ? { en: `${args['plots'].length} plots`, zh: `${args['plots'].length} 条剧情` } : undefined
    case 'write_world_trigger': return createdFields(args['document'])
    default: return undefined
  }
}

export { readAuthoredEntityDocument }
