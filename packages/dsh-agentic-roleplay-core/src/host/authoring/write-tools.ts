import { defineTool, type PreToolDecision, type ToolDefinition, type ToolExecution } from '@deepseek-ai/dsh-tools'
import { authoredWorldOf } from '../../shared/authoring-chat.ts'
import { InvalidEditProblems, parseRelationEdit } from '../../shared/world-state.ts'
import { editWorldPlots, editWorldRelation, readWorldEditor } from '../worlds/world-editor.ts'
import { editWorldInfo } from '../worlds/world-info.ts'
import { parseWorldInfoEdit, type WorldInfo } from '../../shared/world-info.ts'
import { parsePlotsFile } from '../plots/load.ts'
import { deleteTriggerDocument, writeTriggerDocument } from '../triggers/files.ts'
import { loadWorldParts } from '../triggers/parts.ts'
import { checkWorld } from '../worlds/world-check.ts'
import { formatIssue } from '../validation.ts'
import { AUTHORED_ENTITY_KINDS, createAuthoredEntity, deleteAuthoredEntity, readAuthoredEntityDocument, replaceAuthoredEntity, type AuthoredEntityKind } from './documents.ts'
import type { AuthoredWorldReader } from './read-tools.ts'
import { WORLD_FILE_KINDS, isWorldFileKind, writeWorldFile } from './world-files.ts'
import { PACK_MUTATION_TOOLS } from './pack-tools.ts'
import { PROMPT_MUTATION_TOOLS, PROSE_PROMPTS } from './prompt-tools.ts'
import { changedFields, createdFields, plain, sizeOf, type Summary } from './approval-summary.ts'

const output = (value: unknown) => [{ type: 'text' as const, text: JSON.stringify(value, null, 2) }]
const jsonOutput = { schema: { type: 'json' as const }, render: (_args: unknown, value: unknown) => output(value) }
const kindParameter = { type: 'string' as const, required: true as const, enum: AUTHORED_ENTITY_KINDS }
const keyParameter = { type: 'string' as const, required: true as const, description: 'Stable entity key.' }

/** The fields of `world.json` the assistant changes: what the world says about itself. The name, the preset, the lorebooks, the sampling and the tool switches are the person's choices and stay theirs. */
export const WORLD_INFO_FIELDS = ['description', 'tags', 'rules', 'opening', 'alternateOpenings', 'startQuestions', 'startingTime', 'timeZone', 'version', 'authorName', 'authorUrl'] as const

export const AUTHORING_MUTATION_TOOLS = new Set(['import_preset', 'edit_world_info', 'create_world_element', 'replace_world_element', 'delete_world_element', 'edit_world_relationship', 'replace_world_plots', 'write_world_trigger', 'delete_world_trigger', 'write_world_file', ...PROMPT_MUTATION_TOOLS, ...PACK_MUTATION_TOOLS])

function result(action: string, kind: string, key: string, state: Awaited<ReturnType<typeof readWorldEditor>>, extra: Record<string, unknown> = {}): unknown {
  return { action, kind, key, counts: { characters: state.characters.length, locations: state.places.length, items: state.things.length, factions: state.factions.length, lore: state.lore?.length ?? 0, plots: state.plots.length, relationships: state.relations.length }, ...extra }
}

function fileKind(value: unknown) {
  if (!isWorldFileKind(value)) throw new InvalidEditProblems([`kind must be one of ${WORLD_FILE_KINDS.join(', ')}`])
  return value
}

function plotDocument(value: unknown) {
  const parsed = parsePlotsFile(JSON.stringify([value]))
  if (!parsed.ok) throw new InvalidEditProblems(parsed.issues.map(formatIssue))
  return parsed.value[0]!
}

/** Checks a write the way its tool will, and writes nothing: a change the tool would refuse is not put to the person. @throws {InvalidEditProblems} */
export async function validateMutation(reader: AuthoredWorldReader, exec: ToolExecution): Promise<void> {
  const args = exec.arguments as Record<string, unknown>
  if (exec.name !== 'create_world_element' && exec.name !== 'replace_world_element' && exec.name !== 'write_world_trigger' && exec.name !== 'write_world_file') return
  const { record } = await reader.read(exec)
  if (exec.name === 'write_world_file') { await writeWorldFile({ id: record.summary.id, directory: record.directory }, fileKind(args['kind']), args['document'], { dryRun: true }); return }
  const world = { id: record.summary.id, directory: record.directory }
  const key = String(args['key'])
  if (exec.name === 'write_world_trigger') { await writeTriggerDocument(record.directory, await loadWorldParts(record.directory), key, args['document'], { dryRun: true }); return }
  const write = exec.name === 'create_world_element' ? createAuthoredEntity : replaceAuthoredEntity
  await write(world, args['kind'] as AuthoredEntityKind, key, args['document'], { refuseUnread: true, dryRun: true })
}

/** The most problems a write reports back; `check_world` lists the rest. */
const REPORTED_PROBLEMS = 8

/**
 * A write is allowed to leave the world unfinished (a character first, its place next), so the check is advice, not a refusal: the assistant sees at once what its edit
 * left open instead of finding out when a story is started.
 */
export function withWorldCheck(reader: AuthoredWorldReader, tool: ToolDefinition): ToolDefinition {
  const run = tool.execute as (args: unknown, exec: ToolExecution) => Promise<unknown>
  return {
    ...tool,
    async execute(args: never, exec: ToolExecution) {
      const done = await run(args, exec)
      if (done === null || typeof done !== 'object') return done as never
      const { record } = await reader.read(exec)
      const check = await checkWorld(record)
      if (check.ok) return { ...done, check_world: 'ok: a story could start from this world' } as never
      const shown = check.problems.slice(0, REPORTED_PROBLEMS).map(problem => `${problem.where}: ${problem.message}`)
      return { ...done, check_world: { ok: false, still_open: shown, more: check.problems.length - shown.length + check.more, note: 'Not an error of this edit; fix what the world still needs before the end of the turn (check_world lists all).' } } as never
    },
  } as ToolDefinition
}

export function authoredWorldWriteTools(reader: AuthoredWorldReader): ToolDefinition[] {
  return [
    defineTool({
      name: 'create_world_element',
      description: 'Create a character, location, item, faction or lore entry from a complete authored JSON document. The key becomes its stable id. A character that is somewhere in the story needs start.location, the key of an existing place (start: {"location": "yard"}); one without it is in no place. Requires user approval.',
      parameters: { kind: kindParameter, key: keyParameter, document: { type: 'json', required: true, description: 'Complete snake_case document in the world file format.' } },
      output: jsonOutput,
      async execute(args, exec) {
        const { record } = await reader.read(exec)
        const world = { id: record.summary.id, directory: record.directory }
        await createAuthoredEntity(world, args.kind as AuthoredEntityKind, args.key, args.document, { refuseUnread: true })
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
        await replaceAuthoredEntity(world, args.kind as AuthoredEntityKind, args.key, args.document, { refuseUnread: true })
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
      name: 'edit_world_info',
      description: `Change what the world says about itself in world.json: ${WORLD_INFO_FIELDS.join(', ')}. Give only the fields to change, as {"description": "...", "tags": ["..."], "opening": "...", "alternateOpenings": [{"title": "...", "text": "..."}]}: a list replaces the whole list, so read get_world_info first. The description is a short summary (a few sentences). An opening with lines spoken by characters cannot be edited as text. startQuestions is a list of {"id", "text", "options": [{"id", "label", "effect": {...}}]} with two to eight options each; an effect may hold rules (a list of text), opening (the position of an alternate opening), startingTime, clockMode (simulated or real), tools and plots, and {} changes nothing. The name, preset, lorebooks, sampling and tool switches are the person's and cannot be changed here. Requires user approval.`,
      parameters: { changes: { type: 'json', required: true, description: 'The fields to change, with their new values.' } },
      output: jsonOutput,
      async execute(args, exec) {
        const { record } = await reader.read(exec)
        const edit = parseWorldInfoEdit(args.changes)
        const refused = Object.keys(edit).filter(key => !(WORLD_INFO_FIELDS as readonly string[]).includes(key))
        if (refused.length > 0) throw new InvalidEditProblems([`${refused.join(', ')} cannot be changed here: ${WORLD_INFO_FIELDS.join(', ')} can`])
        const info = await editWorldInfo(record.directory, edit)
        await reader.refresh()
        return { action: 'edited', kind: 'world info', changed: Object.keys(edit), info } as never
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
      name: 'write_world_file',
      description: `Replace one whole-world file with a complete document: variables (variables.json, a list of what stories track: key, name, kind number|flag|choice, subject character|item|location|world, min and max for a number (copy the limits the person gave), default, integer, visibility, and an "update" field, a sentence saying when and how it changes, which a tracked value needs so that it moves only when it should; visibility is public, private or hidden), dice (dice.json, {checks: [...]}), commands (commands.json, {commands: [{word, description}]}, the world's own slash commands) or calendar (calendar.json, {hemisphere, holidays: [{id, name, on}]}). Read it with get_world_file first and send the whole document, since it replaces the file; an empty document removes the file. It is checked against the rest of the world as the editor does (a value a character still has, a holiday a trigger names) and refused with every problem. Requires user approval.`,
      parameters: { kind: { type: 'string', required: true, enum: WORLD_FILE_KINDS }, document: { type: 'json', required: true, description: 'The complete document in the file format: a list for variables, an object holding the list for the others.' } },
      output: jsonOutput,
      async execute(args, exec) {
        const { record } = await reader.read(exec)
        await writeWorldFile({ id: record.summary.id, directory: record.directory }, fileKind(args.kind), args.document)
        return result('written', args.kind, args.kind, await readWorldEditor({ id: record.summary.id, directory: record.directory })) as never
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
  ].map(tool => withWorldCheck(reader, tool))
}

/**
 * Every change to the world files is put to the person, except in the turn that has just imported a card into the world: it reviews and corrects what it made.
 * @param reviewing - whether the authoring chat is in such a turn.
 * @param options - `auto` is whether the person chose to have changes made without asking; `current` reads the document a replacement is about to replace, so the question can show what changes.
 */
export async function authoringApproval(exec: ToolExecution, next: () => Promise<PreToolDecision>, reviewing: (chat: string) => Promise<boolean> = () => Promise.resolve(false), options: { auto?: () => boolean; validate?: (exec: ToolExecution) => Promise<void>; current?: (chat: string, kind: AuthoredEntityKind, key: string) => Promise<unknown>; info?: (chat: string) => Promise<WorldInfo | undefined> } = {}): Promise<PreToolDecision> {
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
  // a change the tool would refuse is sent back to the assistant without asking the person to approve it (found live: three approvals in a row for calls that all failed at once)
  try {
    if (exec.name === 'edit_world_relationship') parseRelationEdit(args['change'])
    else await options.validate?.(exec)
  } catch (error) {
    if (error instanceof InvalidEditProblems) return { kind: 'deny', reason: error.message }
    throw error
  }
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
  if (exec.name === 'edit_world_info') {
    const detail = await infoDetail(args['changes'], await options.info?.(exec.agent.session.id).catch(() => undefined))
    return { kind: 'ask', reason: 'edit the authored world\'s description, tags, opening or other world.json fields', displayReason: withDetail({ en: 'Edit what the world says about itself', zh: '编辑世界对自身的描述' }, detail) }
  }
  const kind = typeof args['kind'] === 'string' ? args['kind'] : exec.name === 'edit_world_relationship' ? 'relationship' : exec.name.endsWith('trigger') ? 'trigger' : exec.name === 'write_world_file' ? 'file' : 'plots'
  const key = typeof args['key'] === 'string' ? args['key'] : ''
  const target = key === '' ? kind : `${kind} “${key}”`
  const action = exec.name.startsWith('create') ? 'Create' : exec.name.startsWith('delete') ? 'Delete' : exec.name === 'write_world_trigger' || exec.name === 'write_world_file' ? 'Write' : 'Edit'
  const detail = await detailOf(exec, kind, key, options.current).catch(() => undefined)
  return {
    kind: 'ask',
    reason: `${action.toLowerCase()} authored world ${target}`,
    displayReason: withDetail({ en: `${action} ${target} in the world files`, zh: `${action === 'Create' ? '创建' : action === 'Delete' ? '删除' : action === 'Write' ? '写入' : '编辑'}世界文件中的${target}` }, detail),
  }
}

/** The fields of world.json the edit changes, each from what it is now to what it becomes. */
async function infoDetail(changes: unknown, before: WorldInfo | undefined): Promise<Summary | undefined> {
  let edit: Record<string, unknown>
  try { edit = parseWorldInfoEdit(changes) as Record<string, unknown> } catch { return plain(changes) }
  return before === undefined ? plain(edit) : changedFields(before, { ...before, ...edit })
}

function fileDetail(document: unknown): Summary | undefined {
  const lists = Array.isArray(document) ? [document] : typeof document === 'object' && document !== null ? Object.values(document).filter(Array.isArray) : []
  const entries = lists.length === 0 ? undefined : lists.reduce((sum, list) => sum + list.length, 0)
  return entries === undefined ? undefined : { en: `${entries} entries`, zh: `${entries} 项` }
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
    case 'write_world_file': return fileDetail(args['document'])
    default: return undefined
  }
}

export { readAuthoredEntityDocument }
