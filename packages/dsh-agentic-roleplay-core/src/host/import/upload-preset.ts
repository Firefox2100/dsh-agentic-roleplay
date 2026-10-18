import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { WorldNotFoundError } from '../sessions/errors.ts'
import type { WorldCatalog } from '../worlds/catalog.ts'
import { PRESET_FILE, presetMessage } from './preset-tools.ts'
import { readPreset } from './preset.ts'
import { IMPORT_FOLDER } from './store.ts'

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
  try { await deps.authoring.send(chatSessionId, presetMessage()) } catch (error) { failure = error instanceof Error ? error.message : String(error) }
  return { chatSessionId, preset: preset.name, started: failure === undefined, ...(failure === undefined ? {} : { failure }) }
}
