import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { WorldNotFoundError } from '../sessions/errors.ts'
import type { WorldCatalog } from '../worlds/catalog.ts'
import { PRESET_FILE, presetMessage } from './preset-tools.ts'
import { readPreset } from './preset.ts'
import { IMPORT_FOLDER } from './store.ts'
import { shippedLanguages } from '../prompts/library.ts'
import { deleteWorldPrompt, readWorldPrompt, writeWorldPrompt } from '../prompts/world-prompts.ts'
import { verbatimStyle } from '../presets/verbatim.ts'
import { editWorldInfo } from '../worlds/world-info.ts'

export interface UploadPresetDeps {
  worlds: WorldCatalog
  authoring: { ensure(worldId: string, worldName: string, title: string, language?: string): Promise<string>; send(chat: string, text: string): Promise<void> }
}

export interface UploadedPreset {
  chatSessionId: string
  preset: string
  /** Whether the message that has the chat apply the preset was sent; when it was not, the person can send it themselves. */
  started: boolean
  failure?: string
}

/**
 * Keeps an uploaded narration preset in the world's import folder and has the world's authoring chat apply it, which asks the person before it changes a prompt.
 * @throws {ImportCardError} when the file is not a preset. @throws {WorldNotFoundError} when the world does not exist.
 */
export async function uploadPreset(deps: UploadPresetDeps, worldId: string, file: Buffer, name: string, language?: string): Promise<UploadedPreset> {
  const world = await deps.worlds.find(worldId)
  if (world === undefined) throw new WorldNotFoundError(`there is no world with id "${worldId}"`)
  const preset = readPreset(file, name)
  await mkdir(join(world.directory, IMPORT_FOLDER), { recursive: true })
  await writeFile(join(world.directory, IMPORT_FOLDER, PRESET_FILE), file)
  const chatSessionId = await deps.authoring.ensure(world.summary.id, world.summary.name, `Authoring ${world.summary.name}`, language)
  let failure: string | undefined
  try { await deps.authoring.send(chatSessionId, presetMessage(language)) } catch (error) { failure = error instanceof Error ? error.message : String(error) }
  return { chatSessionId, preset: preset.name, started: failure === undefined, ...(failure === undefined ? {} : { failure }) }
}

const STYLE = 'roleplay/style'

/**
 * Puts the chosen prompts of a preset into a world as its narration style, word for word, with no assistant and no question asked: the person chose it in the dialog.
 * A style the world already carries is moved to the world's trash first, in each language, so nothing is lost; the preset's sampling is written to the world when the file has any.
 * @throws {ImportCardError} when the file is not a preset. @throws {WorldNotFoundError} when the world does not exist.
 */
export async function applyPresetVerbatim(deps: Pick<UploadPresetDeps, 'worlds'>, worldId: string, file: Buffer, name: string): Promise<{ preset: string; replaced: boolean }> {
  const world = await deps.worlds.find(worldId)
  if (world === undefined) throw new WorldNotFoundError(`there is no world with id "${worldId}"`)
  const made = verbatimStyle(file, name)
  let replaced = false
  for (const language of shippedLanguages()) {
    if (readWorldPrompt(world.directory, language, STYLE).carried) { await deleteWorldPrompt(world.directory, language, STYLE); replaced = true }
    await writeWorldPrompt(world.directory, language, STYLE, made.text)
  }
  if (Object.keys(made.sampling).length > 0) { await editWorldInfo(world.directory, { sampling: made.sampling }); await deps.worlds.list({ refresh: true }) }
  return { preset: made.name, replaced }
}
