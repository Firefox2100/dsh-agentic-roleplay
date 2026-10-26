import { readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { languageOf as storyLanguageOf, translator } from 'dsh-roleplay-model'
import { defineTool, type ToolDefinition } from '@deepseek-ai/dsh-tools'
import { PROMPTS_FOLDER, shippedLanguages } from '../prompts/library.ts'
import { writeWorldPrompt } from '../prompts/world-prompts.ts'
import type { WorldCatalog } from '../worlds/catalog.ts'
import { editWorldInfo } from '../worlds/world-info.ts'
import { extractStyleFrom } from './extract.ts'
import { withPlayer } from './items.ts'
import { readPreset } from './preset.ts'
import { IMPORT_FOLDER } from './store.ts'
import type { TextOf } from './run.ts'
import { contextOf, worldOf, type Prompting } from './tools.ts'
import type { ImportSettings } from './service.ts'

export const PRESET_TOOL = 'import_preset'
export const PRESET_FILE = 'preset.json'
const PRESET_PATH = `${IMPORT_FOLDER}/${PRESET_FILE}`

/** The command that has the authoring chat apply a preset that was uploaded to the world. */
export function presetMessage(language?: string): string {
  const tr = translator(storyLanguageOf(language))
  return tr('Apply the narration preset I uploaded to this world: call {tool} with file {file}.', { tool: PRESET_TOOL, file: PRESET_PATH })
}

/** The tool that turns an uploaded narration preset into the world's prose prompts; every call asks the person first. */
export function presetTools(worlds: WorldCatalog, settings: () => ImportSettings, prompting: Prompting): ToolDefinition[] {
  return [defineTool({
    name: PRESET_TOOL,
    description: `Turn the narration preset the person uploaded to this world (${PRESET_PATH}) into the world's prose prompts: how the narration is written and how the characters speak and behave. Rules of the game, formats and scripts in the preset are not carried; the sampling it asks (temperature and so on) is written into the world's suggested sampling. It replaces the world's own versions of those prompts, so the person is asked first.`,
    parameters: { file: { type: 'string', required: true, description: `The preset: ${PRESET_PATH}.` } },
    output: { schema: { type: 'json' }, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 1) }] },
    isConcurrencySafe: () => false,
    async execute(args, exec) {
      if (args.file.trim() !== PRESET_PATH) throw new Error(`the preset is ${PRESET_PATH}`)
      const world = await worldOf(worlds, exec)
      const file = join(world.directory, IMPORT_FOLDER, PRESET_FILE)
      const preset = readPreset(await readFile(file).catch(() => { throw new Error('no preset was uploaded to this world') }), 'preset')
      const language = prompting.languages().get(world.id)
      const text: TextOf = (id, variables) => prompting.prompts().text(id, language, variables)
      const made = await extractStyleFrom(contextOf(exec, settings(), text), preset.name, preset.pieces)
      for (const { id, text: body } of made.prompts) for (const tag of shippedLanguages()) await writeWorldPrompt(world.directory, tag, id, withPlayer(body))
      const carriesSampling = Object.keys(preset.sampling).length > 0
      if (carriesSampling) { await editWorldInfo(world.directory, { sampling: preset.sampling }); await worlds.list({ refresh: true }) }
      await rm(file, { force: true })
      const written = made.prompts.map(entry => entry.id)
      return JSON.parse(JSON.stringify({
        preset: preset.name, written, sampling: carriesSampling ? preset.sampling : undefined, folder: `${PROMPTS_FOLDER}/<language>/`, notes: made.notes,
        next: written.length === 0 ? 'Nothing in the preset was about how to write the story, so no prompt was changed: tell the person.' : 'Tell the person which prompts were written (they can read and edit them in the world\'s Prompts section), the sampling that was set (About section) and what was not carried over.',
      })) as never
    },
  })]
}
