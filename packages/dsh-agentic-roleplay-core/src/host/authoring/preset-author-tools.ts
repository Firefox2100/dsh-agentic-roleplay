import { existsSync } from 'node:fs'
import { readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { defineTool, type PreToolDecision, type ToolDefinition, type ToolExecution } from '@deepseek-ai/dsh-tools'
import { presetOfChat } from '../../shared/preset-chat.ts'
import { extractStyleFrom } from '../import/extract.ts'
import { withPlayer } from '../import/items.ts'
import { readPreset as readStPreset } from '../import/preset.ts'
import type { ImportSettings } from '../import/service.ts'
import { IMPORT_FOLDER } from '../import/store.ts'
import { contextOf, type Prompting } from '../import/tools.ts'
import type { TextOf } from '../import/run.ts'
import { PRESET_FILE, presetDirectory, readPreset, updatePresetInfo } from '../presets/presets.ts'
import { languageOf, shippedLanguages, shippedPromptsDirectory } from '../prompts/library.ts'
import { deleteWorldPrompt, listWorldPrompts, PROSE_PROMPTS, readWorldPrompt, writeWorldPrompt } from '../prompts/world-prompts.ts'

export const PRESET_MUTATION_TOOLS = ['write_preset_prompt', 'delete_preset_prompt', 'write_preset_info', 'import_narration_preset'] as const
export const NARRATION_IMPORT_TOOL = 'import_narration_preset'
const UPLOAD_PATH = `${IMPORT_FOLDER}/${PRESET_FILE}`

/** The command that has a preset's authoring chat turn an uploaded SillyTavern preset into prompts. */
export const narrationImportMessage = (): string => `Turn the SillyTavern preset I uploaded into this preset's prompts: call ${NARRATION_IMPORT_TOOL} with file ${UPLOAD_PATH}.`

const output = (value: unknown) => [{ type: 'text' as const, text: JSON.stringify(value, null, 2) }]
const jsonOutput = { schema: { type: 'json' as const }, render: (_args: unknown, value: unknown) => output(value) }
const json = (value: unknown): never => JSON.parse(JSON.stringify(value)) as never
const idParameter = { type: 'string' as const, required: true as const, description: 'The prompt, such as roleplay/style. The prose prompts are roleplay/persona, roleplay/style and roleplay/character-style; every other roleplay/ prompt holds rules of the game (see list_preset_prompts).' }

/** Whether a prompt holds rules of the game, which tell the models how to work and not only how the story reads. */
export const isRulesPrompt = (id: unknown): boolean => typeof id === 'string' && !PROSE_PROMPTS.includes(id)
const languageParameter = { type: 'string' as const, required: true as const, description: 'The language folder, such as en or zh.' }

/** Resolves every call from its preset authoring chat, so a tool can only reach the preset the chat is about. */
export class PresetReader {
  constructor(private readonly root: () => string) {}

  directory(exec: { agent?: { session: { id: string } } }): { name: string; directory: string } {
    const chat = exec.agent?.session.id
    const name = chat === undefined ? undefined : presetOfChat(chat)
    if (name === undefined) throw new Error('this tool is available only in a preset authoring chat')
    const directory = presetDirectory(this.root(), name)
    if (!existsSync(directory)) throw new Error(`the preset "${name}" no longer exists`)
    return { name, directory }
  }

  get library(): string { return this.root() }
}

/** Read and write the prompts and the information of the preset the chat is about. The files are those a story start copies, so they are checked as it checks them. */
export function presetAuthorTools(reader: PresetReader, settings: () => ImportSettings, prompting: Prompting, shipped: string = shippedPromptsDirectory()): ToolDefinition[] {
  return [
    defineTool({
      name: 'read_preset_info',
      description: 'Read the preset\'s title, description, suggested temperatures, the languages it has prompts in and any problems it has.',
      parameters: {},
      output: jsonOutput,
      isConcurrencySafe: () => true,
      async execute(_args, exec) {
        const { name, directory } = reader.directory(exec)
        return json(readPreset(directory, name, shipped).summary)
      },
    }),
    defineTool({
      name: 'list_preset_prompts',
      description: 'List every prompt of the story, in a language, with its kind (prose, or rules of the game) and whether this preset carries its own version.',
      parameters: { language: languageParameter },
      output: jsonOutput,
      isConcurrencySafe: () => true,
      async execute(args, exec) {
        const { directory } = reader.directory(exec)
        return json(listWorldPrompts(directory, args.language, shipped))
      },
    }),
    defineTool({
      name: 'read_preset_prompt',
      description: 'Read a prompt of the preset. When the preset does not carry it in that language, the shipped text is returned (carried: false), which is what a story would use and a good starting point. ${name} marks a value the program fills in.',
      parameters: { id: idParameter, language: languageParameter },
      output: jsonOutput,
      isConcurrencySafe: () => true,
      async execute(args, exec) {
        const { directory } = reader.directory(exec)
        return json(readWorldPrompt(directory, args.language, args.id, shipped))
      },
    }),
    defineTool({
      name: 'write_preset_prompt',
      description: 'Create or replace the preset\'s version of a prompt in a language. It must not be empty and may use only the ${variables} the shipped prompt uses; tool names and field names in it must stay as they are. Read it first and change only what is needed. Prompts other than the three prose ones hold rules of the game: change them only when the person asked for it, keep the shipped text and add to it rather than replacing it, and know that the person is shown a warning. Requires user approval.',
      parameters: { id: idParameter, language: languageParameter, text: { type: 'string', required: true, description: 'The complete prompt text.' } },
      output: jsonOutput,
      async execute(args, exec) {
        const { directory } = reader.directory(exec)
        if (!args.id.startsWith('roleplay/')) throw new Error(`"${args.id}" is not a prompt of the story`)
        await writeWorldPrompt(directory, args.language, args.id, args.text, shipped)
        return json({ action: 'written', id: args.id, language: languageOf(args.language) })
      },
    }),
    defineTool({
      name: 'delete_preset_prompt',
      description: 'Remove the preset\'s version of a prompt in a language; stories started with the preset then use the shipped one. The file is moved into the preset\'s .trash. Requires user approval.',
      parameters: { id: idParameter, language: languageParameter },
      output: jsonOutput,
      async execute(args, exec) {
        const { directory } = reader.directory(exec)
        const trashPath = await deleteWorldPrompt(directory, args.language, args.id, shipped)
        return json({ action: 'deleted', id: args.id, language: languageOf(args.language), trashPath })
      },
    }),
    defineTool({
      name: 'write_preset_info',
      description: 'Change the preset\'s title, description (up to 300 characters each) and suggested sampling. Give only what changes; sampling replaces the suggested values as a whole ({} suggests none): master and characters are temperatures from 0 to 2; topP and minP 0 to 1, topK 0 to 1000, frequencyPenalty and presencePenalty -2 to 2, repetitionPenalty 0 to 2 apply to both. Requires user approval.',
      parameters: {
        title: { type: 'string', description: 'A short name to show; empty to clear.' },
        description: { type: 'string', description: 'What the preset is for; empty to clear.' },
        sampling: { type: 'json', description: 'For example {"master": 0.9, "characters": 0.85, "topP": 0.95}.' },
      },
      output: jsonOutput,
      async execute(args, exec) {
        const { name } = reader.directory(exec)
        const sampling = args.sampling
        if (sampling !== undefined && (typeof sampling !== 'object' || sampling === null || Array.isArray(sampling))) throw new Error('"sampling" must be an object')
        const loaded = await updatePresetInfo(reader.library, name, { ...(args.title === undefined ? {} : { title: args.title }), ...(args.description === undefined ? {} : { description: args.description }), ...(sampling === undefined ? {} : { sampling: sampling as never }) })
        return json({ action: 'written', summary: loaded.summary })
      },
    }),
    defineTool({
      name: NARRATION_IMPORT_TOOL,
      description: `Turn the SillyTavern preset the person uploaded (${UPLOAD_PATH}) into this preset's prose prompts, in every language the program ships. Rules of the game, formats and scripts in the uploaded preset are not carried. It replaces this preset's versions of those prompts, so the person is asked first unless the preset has none yet.`,
      parameters: { file: { type: 'string', required: true, description: `The uploaded preset: ${UPLOAD_PATH}.` } },
      output: jsonOutput,
      isConcurrencySafe: () => false,
      async execute(args, exec) {
        if (args.file.trim() !== UPLOAD_PATH) throw new Error(`the uploaded preset is ${UPLOAD_PATH}`)
        const { name, directory } = reader.directory(exec)
        const file = join(directory, IMPORT_FOLDER, PRESET_FILE)
        const uploaded = readStPreset(await readFile(file).catch(() => { throw new Error('no preset was uploaded here') }), name)
        const language = prompting.languages().get(`preset:${name}`)
        const text: TextOf = (id, variables) => prompting.prompts().text(id, language, variables)
        const made = await extractStyleFrom(contextOf(exec, settings(), text), uploaded.name, uploaded.pieces)
        for (const { id, text: body } of made.prompts) for (const tag of shippedLanguages(shipped)) await writeWorldPrompt(directory, tag, id, withPlayer(body), shipped)
        await rm(join(directory, IMPORT_FOLDER), { recursive: true, force: true })
        const written = made.prompts.map(entry => entry.id)
        return json({
          written, notes: made.notes,
          next: written.length === 0 ? 'Nothing in the uploaded preset was about how to write the story, so no prompt was written: tell the person.' : 'Tell the person which prompts were written (they can read and edit them here or in the Presets page) and what was not carried over.',
        })
      },
    }),
  ]
}

/** Every change to a preset is put to the person; the first import into an empty preset only fills it, so it is not. */
export async function presetApproval(exec: ToolExecution, next: () => Promise<PreToolDecision>, carries: (chat: string) => boolean): Promise<PreToolDecision> {
  if (!(PRESET_MUTATION_TOOLS as readonly string[]).includes(exec.name) || exec.agent === undefined || presetOfChat(exec.agent.session.id) === undefined) return await next()
  const args = exec.arguments as Record<string, unknown>
  const chat = exec.agent.session.id
  if (exec.name === NARRATION_IMPORT_TOOL) {
    if (!carries(chat)) return await next()
    return { kind: 'ask', reason: 'replace the preset\'s prompts with ones made from the uploaded preset', displayReason: { en: 'Replace this preset\'s prompts with ones made from the uploaded preset?', zh: '用上传的预设生成的提示词，替换此预设的提示词？' } }
  }
  if (exec.name === 'write_preset_info') return { kind: 'ask', reason: 'change the preset\'s title, description or suggested temperatures', displayReason: { en: 'Change the preset\'s title, description or temperatures?', zh: '修改预设的标题、描述或建议温度？' } }
  const target = `prompt “${String(args['language'])}/${String(args['id'])}”`
  const remove = exec.name.startsWith('delete')
  if (isRulesPrompt(args['id'])) return { kind: 'ask', reason: `${remove ? 'delete' : 'write'} preset ${target}, a rules prompt`, displayReason: { en: `WARNING: ${target} holds rules of the game, not only prose. ${remove ? 'Delete' : 'Write'} it in the preset? A wrong change can break how the story runs.`, zh: `警告：${target}属于游戏规则，而不只是文风。${remove ? '删除' : '写入'}预设中的这条提示词？改错可能会影响故事的运行。` } }
  return { kind: 'ask', reason: `${remove ? 'delete' : 'write'} preset ${target}`, displayReason: { en: `${remove ? 'Delete' : 'Write'} ${target} in the preset?`, zh: `${remove ? '删除' : '写入'}预设中的${target}？` } }
}
