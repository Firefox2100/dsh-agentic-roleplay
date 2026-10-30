import { languageOf as storyLanguageOf, translator } from 'dsh-roleplay-model'
import { IMPORT_COMMAND, type ImportChoices } from '../../shared/import-card.ts'
import { trimCharacters } from '../../shared/text.ts'
import type { WorldSummary } from '../../shared/worlds.ts'
import { InvalidEditProblems } from '../../shared/world-state.ts'
import { WorldNotFoundError } from '../sessions/errors.ts'
import type { WorldCatalog } from '../worlds/catalog.ts'
import { authoringTitle } from '../agent/authoring-sessions.ts'
import { WorldFolderExistsError, createWorld } from '../worlds/create-world.ts'
import { IMPORT_FOLDER, type ImportStore } from './store.ts'
import { importPhase, markReady } from './run-import.ts'

export interface StartImportDeps {
  store: ImportStore
  worlds: WorldCatalog
  /** Creates or reopens the authoring chat of a world and says what the person sees in it. */
  authoring: { ensure(worldId: string, worldName: string, title: string, language?: string): Promise<string>; send(chat: string, text: string): Promise<void> }
}

export interface StartedImport {
  worldId: string
  chatSessionId: string
  /** Whether the message that starts the import was sent; when it was not, the person can send it themselves. */
  started: boolean
  /** Why it was not sent. */
  failure?: string
}

const FOLDER_CHARS = /[^\p{L}\p{N}._ -]+/gu

/** A name that can be the folder of a world: letters, digits and a few marks, trimmed, not ending in a dot or space. */
export function folderNameOf(name: string): string {
  const normalized = name.normalize('NFKC').replace(FOLDER_CHARS, ' ').replace(/\s+/g, ' ').trim()
  const characters = [...normalized]
  const first = characters.findIndex(character => /[\p{L}\p{N}]/u.test(character))
  const cleaned = first < 0 ? '' : characters.slice(first).join('')
  const folder = trimCharacters(cleaned, '. ', 'end').slice(0, 90).trim()
  return folder === '' ? 'imported world' : folder
}

/** The command that starts the import, for a card kept in the world's import folder. */
export function importMessage(language?: string): string {
  const tr = translator(storyLanguageOf(language))
  return `${IMPORT_COMMAND} ${IMPORT_FOLDER}/card.json ${tr('Import this card into this newly created world.')}`
}

/**
 * Has the chat of a world whose import stopped before it was done carry on from the step it reached (the import hooks tell the chat which step that is). An import is lost
 * to a server restart, a refused finish or a chat that ended early; the card and what was extracted stay in the world's import folder.
 * @throws {WorldNotFoundError} when the world is gone. @throws {InvalidEditProblems} when no import is waiting in it.
 */
export async function resumeImport(deps: Pick<StartImportDeps, 'worlds' | 'authoring'>, worldId: string, language?: string): Promise<StartedImport> {
  const record = await deps.worlds.find(worldId)
  if (record === undefined) throw new WorldNotFoundError(`there is no world with id "${worldId}"`)
  const phase = await importPhase(record.directory)
  if (phase === undefined || phase === 'done') throw new InvalidEditProblems(['no import is waiting in this world'])
  const chatSessionId = await deps.authoring.ensure(record.summary.id, record.summary.name, authoringTitle(record.summary.name, language), language)
  let failure: string | undefined
  try { await deps.authoring.send(chatSessionId, importMessage(language)) } catch (error) { failure = error instanceof Error ? error.message : String(error) }
  return { worldId: record.summary.id, chatSessionId, started: failure === undefined, ...(failure === undefined ? {} : { failure }) }
}

/**
 * Turns an uploaded card into a new empty world with its authoring chat, and has the chat start importing it on the person's behalf.
 * @throws {InvalidEditProblems} when the choices cannot be used. @throws {ImportNotFoundError} when the upload is gone.
 */
export async function startImport(deps: StartImportDeps, id: string, choices: ImportChoices, language?: string): Promise<StartedImport> {
  await deps.store.choose(id, choices)
  let world: WorldSummary | undefined
  const base = folderNameOf(choices.name)
  for (let attempt = 1; world === undefined; attempt += 1) {
    if (attempt > 50) throw new InvalidEditProblems(['there are too many worlds with that name: choose another'])
    try {
      world = await createWorld(deps.worlds, { folder: attempt === 1 ? base : `${base} ${attempt}`, name: choices.name })
    } catch (error) {
      if (!(error instanceof WorldFolderExistsError)) throw error
    }
  }
  const record = await deps.worlds.find(world.id)
  if (record === undefined) throw new WorldNotFoundError(`the world "${world.name}" was made but cannot be found`)
  await deps.store.adopt(id, record.directory)
  await markReady(record.directory)
  const chatSessionId = await deps.authoring.ensure(world.id, world.name, authoringTitle(world.name, language), language)
  let failure: string | undefined
  try {
    await deps.authoring.send(chatSessionId, importMessage(language))
  } catch (error) {
    failure = error instanceof Error ? error.message : String(error)
  }
  return { worldId: world.id, chatSessionId, started: failure === undefined, ...(failure === undefined ? {} : { failure }) }
}
