import { existsSync, readFileSync } from 'node:fs'
import { readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { defineTool, type PreToolDecision, type ToolDefinition, type ToolExecution } from '@deepseek-ai/dsh-tools'
import { LORE_KINDS, LORE_SCOPES } from 'dsh-roleplay-model'
import { lorebookOfChat } from '../../shared/lorebook-chat.ts'
import type { LorebookEntry } from '../../shared/lorebooks.ts'
import { classifyEntries, isRulesTarget, readLorebook as readStLorebook, STEERING_TARGETS, type SteeringTarget } from '../import/lorebook.ts'
import type { ImportSettings } from '../import/service.ts'
import { IMPORT_FOLDER } from '../import/store.ts'
import { contextOf, type Prompting } from '../import/tools.ts'
import type { TextOf } from '../import/run.ts'
import { deleteLorebookEntry, entriesOf, loadLorebook, lorebookDirectory, readLorebook, updateLorebookInfo, writeLorebookEntry } from '../lorebooks/lorebooks.ts'
import { createPresetFromGuidance } from '../presets/presets.ts'
import { shippedPromptsDirectory } from '../prompts/library.ts'

export const LOREBOOK_MUTATION_TOOLS = ['write_lorebook_entry', 'delete_lorebook_entry', 'write_lorebook_info', 'import_lorebook', 'apply_steering'] as const
export const LOREBOOK_IMPORT_TOOL = 'import_lorebook'
export const STEERING_TOOL = 'apply_steering'
export const LOREBOOK_UPLOAD = `${IMPORT_FOLDER}/lorebook.json`
const STEERING_FILE = 'steering.json'

/** The command that has a lorebook's authoring chat turn an uploaded SillyTavern lorebook into entries. */
export const lorebookImportMessage = (): string => `Turn the SillyTavern lorebook I uploaded into this lorebook: call ${LOREBOOK_IMPORT_TOOL} with file ${LOREBOOK_UPLOAD}.`

const output = (value: unknown) => [{ type: 'text' as const, text: JSON.stringify(value, null, 2) }]
const jsonOutput = { schema: { type: 'json' as const }, render: (_args: unknown, value: unknown) => output(value) }
const json = (value: unknown): never => JSON.parse(JSON.stringify(value)) as never

/** Instructions an import found that are not facts of the world, waiting for the person to have them made a preset. */
interface Pending {
  source: string
  guidance: Record<string, string[]>
  /** The entries each line of guidance replaced, by prompt, in the same order; absent in files an earlier version wrote. */
  from?: Record<string, string[]>
}

/** The ids of the prompts waiting guidance would be written into, and whether any of them holds rules of the game. */
export function pendingTargets(directory: string): { ids: string[]; rules: boolean } {
  const file = join(directory, IMPORT_FOLDER, STEERING_FILE)
  if (!existsSync(file)) return { ids: [], rules: false }
  const pending = JSON.parse(readFileSync(file, 'utf8')) as Pending
  const ids = Object.keys(pending.guidance)
  return { ids, rules: ids.some(id => !['roleplay/persona', 'roleplay/style', 'roleplay/character-style'].includes(id)) }
}

/** Resolves every call from its lorebook authoring chat, so a tool can only reach the lorebook the chat is about. */
export class LorebookReader {
  constructor(private readonly root: () => string) {}

  directory(exec: { agent?: { session: { id: string } } }): { name: string; directory: string } {
    const chat = exec.agent?.session.id
    const name = chat === undefined ? undefined : lorebookOfChat(chat)
    if (name === undefined) throw new Error('this tool is available only in a lorebook authoring chat')
    const directory = lorebookDirectory(this.root(), name)
    if (!existsSync(directory)) throw new Error(`the lorebook "${name}" no longer exists`)
    return { name, directory }
  }

  get library(): string { return this.root() }
}

const entryParameters = {
  id: { type: 'string' as const, required: true as const, description: 'The entry\'s id: letters, digits, "-" and "_" (also used as its folder name).' },
}

/** Read and write the entries and the information of the lorebook the chat is about; the files are those a story start copies, so they are checked as it checks them. */
export function lorebookAuthorTools(reader: LorebookReader, settings: () => ImportSettings, prompting: Prompting, shipped: string = shippedPromptsDirectory()): ToolDefinition[] {
  return [
    defineTool({
      name: 'read_lorebook_info',
      description: 'Read the lorebook\'s title, description, how many entries it has, how many everyone knows, and any problems it has.',
      parameters: {},
      output: jsonOutput,
      isConcurrencySafe: () => true,
      async execute(_args, exec) {
        const { name, directory } = reader.directory(exec)
        return json({ ...(await readLorebook(directory, name)).summary, waitingGuidance: pendingTargets(directory).ids })
      },
    }),
    defineTool({
      name: 'list_lorebook_entries',
      description: 'List the entries of the lorebook with their kind, who knows them (scope) and summary, without the full text.',
      parameters: {},
      output: jsonOutput,
      isConcurrencySafe: () => true,
      async execute(_args, exec) {
        const { name, directory } = reader.directory(exec)
        return json(entriesOf(await readLorebook(directory, name)).map(({ body, ...rest }) => ({ ...rest, characters: body.length })))
      },
    }),
    defineTool({
      name: 'read_lorebook_entry',
      description: 'Read one entry of the lorebook in full.',
      parameters: entryParameters,
      output: jsonOutput,
      isConcurrencySafe: () => true,
      async execute(args, exec) {
        const { name, directory } = reader.directory(exec)
        const found = entriesOf(await readLorebook(directory, name)).find(entry => entry.id === args.id)
        if (found === undefined) throw new Error(`the lorebook has no entry "${args.id}"`)
        return json(found)
      },
    }),
    defineTool({
      name: 'write_lorebook_entry',
      description: 'Create or replace an entry: a fact of the world, written as reference prose that keeps every detail. scope is "everyone" (common knowledge, which is the default and what a lorebook is for) or "listed", which only the characters in known_by know (by name, as they are called in the worlds it is used in; the game master always reads everything). Give the whole entry. Requires user approval.',
      parameters: {
        ...entryParameters,
        title: { type: 'string', required: true, description: 'A short title.' },
        kind: { type: 'string', required: true, enum: [...LORE_KINDS], description: 'What kind of fact it is; other when none fits.' },
        scope: { type: 'string', required: true, enum: [...LORE_SCOPES] },
        known_by: { type: 'array', items: { type: 'string' }, description: 'For a listed entry: who knows it.' },
        summary: { type: 'string', description: 'One sentence saying what the entry tells.' },
        body: { type: 'string', required: true, description: 'The entry\'s text.' },
        related: { type: 'array', items: { type: 'string' }, description: 'Ids of other entries of this book it goes with.' },
      },
      output: jsonOutput,
      async execute(args, exec) {
        const { name } = reader.directory(exec)
        const entry: LorebookEntry = { id: args.id, title: args.title, kind: args.kind as LorebookEntry['kind'], scope: args.scope as LorebookEntry['scope'], knownBy: args.known_by ?? [], summary: args.summary ?? '', body: args.body, related: args.related ?? [] }
        const book = await writeLorebookEntry(reader.library, name, entry)
        return json({ action: 'written', id: args.id, entries: book.summary.entries, problems: book.summary.problems })
      },
    }),
    defineTool({
      name: 'delete_lorebook_entry',
      description: 'Remove an entry; it is moved into the lorebook\'s .trash. Refused while another entry relates to it. Requires user approval.',
      parameters: entryParameters,
      output: jsonOutput,
      async execute(args, exec) {
        const { name } = reader.directory(exec)
        return json({ action: 'deleted', id: args.id, entries: (await deleteLorebookEntry(reader.library, name, args.id)).summary.entries })
      },
    }),
    defineTool({
      name: 'write_lorebook_info',
      description: 'Change the lorebook\'s title and description (up to 300 characters each). Give only what changes. Requires user approval.',
      parameters: { title: { type: 'string', description: 'A short name to show; empty to clear.' }, description: { type: 'string', description: 'What the lorebook is about; empty to clear.' } },
      output: jsonOutput,
      async execute(args, exec) {
        const { name } = reader.directory(exec)
        return json({ action: 'written', summary: (await updateLorebookInfo(reader.library, name, { ...(args.title === undefined ? {} : { title: args.title }), ...(args.description === undefined ? {} : { description: args.description }) })).summary })
      },
    }),
    defineTool({
      name: 'read_waiting_guidance',
      description: 'Read the instructions to the AI that the import found in the uploaded lorebook and has not yet put into a preset, by the prompt they would be added to.',
      parameters: {},
      output: jsonOutput,
      isConcurrencySafe: () => true,
      async execute(_args, exec) {
        const { directory } = reader.directory(exec)
        const file = join(directory, IMPORT_FOLDER, STEERING_FILE)
        return json(existsSync(file) ? JSON.parse(await readFile(file, 'utf8')) : { guidance: {} })
      },
    }),
    defineTool({
      name: LOREBOOK_IMPORT_TOOL,
      description: `Turn the SillyTavern lorebook the person uploaded (${LOREBOOK_UPLOAD}) into entries of this lorebook. Facts of the world are kept word for word as entries that everyone in a story knows, unless an entry clearly says only some characters know it. Instructions to the AI are not facts: they are kept aside, and ${STEERING_TOOL} puts them into a preset. Takes a few minutes. The person is asked first unless the lorebook is still empty.`,
      parameters: { file: { type: 'string', required: true, description: `The uploaded lorebook: ${LOREBOOK_UPLOAD}.` } },
      output: jsonOutput,
      isConcurrencySafe: () => false,
      async execute(args, exec) {
        if (args.file.trim() !== LOREBOOK_UPLOAD) throw new Error(`the uploaded lorebook is ${LOREBOOK_UPLOAD}`)
        const { name, directory } = reader.directory(exec)
        const uploaded = readStLorebook(await readFile(join(directory, IMPORT_FOLDER, 'lorebook.json')).catch(() => { throw new Error('no lorebook was uploaded here') }), name)
        const language = prompting.languages().get(`lorebook:${name}`)
        const text: TextOf = (id, variables) => prompting.prompts().text(id, language, variables)
        const made = await classifyEntries(contextOf(exec, settings(), text), uploaded)
        const taken = new Set((await loadLorebook(reader.library, name)).entries.map(entry => entry.id))
        for (const entry of made.entries) {
          let id = entry.id
          for (let n = 2; taken.has(id); n += 1) id = `${entry.id}-${n}`
          taken.add(id)
          await writeLorebookEntry(reader.library, name, { ...entry, id })
        }
        const guidance = Object.fromEntries(Object.entries(made.steering).map(([target, lines]) => [STEERING_TARGETS[target as SteeringTarget], lines]))
        const from = Object.fromEntries(Object.entries(made.steeringFrom).map(([target, titles]) => [STEERING_TARGETS[target as SteeringTarget], titles]))
        if (Object.keys(guidance).length > 0) await writeFile(join(directory, IMPORT_FOLDER, STEERING_FILE), JSON.stringify({ source: uploaded.name, guidance, from } satisfies Pending, null, 2))
        await rm(join(directory, IMPORT_FOLDER, 'lorebook.json'), { force: true })
        const waiting = Object.keys(guidance)
        return json({
          entries: made.entries.length, everyone: made.entries.filter(entry => entry.scope === 'everyone').length, listed: made.entries.filter(entry => entry.scope === 'listed').map(entry => ({ title: entry.title, knownBy: entry.knownBy })),
          notes: made.notes, waitingGuidance: waiting, rulesPrompts: waiting.filter(id => isRulesTarget(Object.entries(STEERING_TARGETS).find(([, value]) => value === id)![0] as SteeringTarget)),
          next: waiting.length === 0 ? 'Tell the person how many entries were made, what was left out, and any entry that is known only to some characters.' : `Tell the person how many entries were made and what was left out. ${waiting.length} prompt(s) have instructions waiting (${waiting.join(', ')}): say what they are about (read_waiting_guidance), warn the person that any prompt other than roleplay/persona, roleplay/style and roleplay/character-style holds rules of the game, and ask whether to call ${STEERING_TOOL} to put them into a new preset.`,
        })
      },
    }),
    defineTool({
      name: STEERING_TOOL,
      description: 'Make a new preset in the preset library from the instructions the import set aside: each prompt keeps its shipped text and the instructions follow it, in every language. Prompts other than the three prose ones hold rules of the game, and the person is warned. Requires user approval.',
      parameters: { preset: { type: 'string', description: 'The preset\'s name (letters, digits, "-" and "_"); the lorebook\'s own name when left out.' }, title: { type: 'string', description: 'The preset\'s title.' } },
      output: jsonOutput,
      isConcurrencySafe: () => false,
      async execute(args, exec) {
        const { name, directory } = reader.directory(exec)
        const file = join(directory, IMPORT_FOLDER, STEERING_FILE)
        if (!existsSync(file)) throw new Error('there is no guidance waiting')
        const pending = JSON.parse(await readFile(file, 'utf8')) as Pending
        const made = await createPresetFromGuidance(reader.library, { name: args.preset?.trim() || name, title: args.title ?? pending.source }, pending.guidance, shipped)
        await rm(file, { force: true })
        return json({ action: 'preset made', preset: made.summary.name, prompts: made.summary.prompts, rules: made.summary.rules, next: 'Tell the person the preset name and that they can choose it when starting a story, or set it as a world\'s suggested preset.' })
      },
    }),
  ]
}

/** Every change to a lorebook is put to the person; the first import into an empty one only fills it, and a preset made of guidance warns when it touches rules of the game. */
export async function lorebookApproval(exec: ToolExecution, next: () => Promise<PreToolDecision>, state: { carries: (chat: string) => boolean; waiting: (chat: string) => { ids: string[]; rules: boolean } }): Promise<PreToolDecision> {
  if (!(LOREBOOK_MUTATION_TOOLS as readonly string[]).includes(exec.name) || exec.agent === undefined || lorebookOfChat(exec.agent.session.id) === undefined) return await next()
  const args = exec.arguments as Record<string, unknown>
  const chat = exec.agent.session.id
  if (exec.name === LOREBOOK_IMPORT_TOOL) {
    if (!state.carries(chat)) return await next()
    return { kind: 'ask', reason: 'add the entries of the uploaded lorebook to this lorebook', displayReason: { en: 'Add the entries of the uploaded lorebook to this lorebook?', zh: '把上传的世界书中的条目加入此世界书？' } }
  }
  if (exec.name === STEERING_TOOL) {
    const { ids, rules } = state.waiting(chat)
    const list = ids.join(', ')
    if (rules) return { kind: 'ask', reason: `make a preset from the instructions of the lorebook, including rules prompts (${list})`, displayReason: { en: `WARNING: make a preset that adds the lorebook's instructions to ${list}? Some of these prompts hold rules of the game, not only prose; a wrong instruction can break how the story runs.`, zh: `警告：创建一个预设，把世界书中的指令加入 ${list}？其中一些提示词属于游戏规则，而不只是文风；错误的指令可能影响故事的运行。` } }
    return { kind: 'ask', reason: `make a preset from the instructions of the lorebook (${list})`, displayReason: { en: `Make a preset that adds the lorebook's instructions to ${list}?`, zh: `创建一个预设，把世界书中的指令加入 ${list}？` } }
  }
  if (exec.name === 'write_lorebook_info') return { kind: 'ask', reason: 'change the lorebook\'s title or description', displayReason: { en: 'Change the lorebook\'s title or description?', zh: '修改世界书的标题或描述？' } }
  const target = `entry “${String(args['id'])}”`
  const remove = exec.name.startsWith('delete')
  return { kind: 'ask', reason: `${remove ? 'delete' : 'write'} lorebook ${target}`, displayReason: { en: `${remove ? 'Delete' : 'Write'} ${target} in the lorebook?`, zh: `${remove ? '删除' : '写入'}世界书中的${target}？` } }
}
