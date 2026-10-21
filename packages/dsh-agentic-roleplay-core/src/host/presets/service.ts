import { existsSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { trimCharacters } from '../../shared/text.ts'
import { isSessionId, sessionDatabase, sessionFolder } from '@dsh-agentic-roleplay/state'
import type { SelectionChoice } from '../../shared/import-selection.ts'
import type { ImportStaging } from '../import/staging.ts'
import type { PresetChange, PresetStatus, PresetSummary, SavePresetRequest } from '../../shared/presets.ts'
import { SessionNotFoundError, WorldNotFoundError } from '../sessions/errors.ts'
import { presetStatus, switchPreset } from './apply.ts'
import { IMPORT_FOLDER } from '../import/store.ts'
import { readPreset as readStPreset } from '../import/preset.ts'
import { deleteWorldPrompt, listWorldPrompts, readWorldPrompt, writeWorldPrompt } from '../prompts/world-prompts.ts'
import { shippedLanguages } from '../prompts/library.ts'
import { verbatimStyle } from './verbatim.ts'
import { createPresetFromShipped, deletePreset, isPresetName, listPresets, loadPreset, PRESET_FILE, presetDirectory, reservePreset, savePresetFromWorld, updatePresetInfo, type PresetInfoChange } from './presets.ts'

export interface PresetDeps {
  /** Read for each call, because the roleplay root can move. */
  root: () => string
  worldDirectory: (worldId: string) => Promise<string | undefined>
  /** Opens the authoring chat of a preset and says something in it for the person. */
  authoring: { ensure(name: string, title: string, language?: string): Promise<string>; send(chat: string, text: string): Promise<void> }
  /** The message that has the chat turn the uploaded preset into prompts. */
  importMessage: () => string
  maxUploadBytes: number
  /** Files waiting for the person to choose what of them is imported. */
  staging: ImportStaging
  /** Whether a turn of the story is being played, when its prompts must not change. */
  playing: (session: string) => boolean
}

/** The story's prompts cannot change right now. */
export class PresetBusyError extends Error {}

export interface PresetAuthoringOpened {
  chatSessionId: string
  /** Whether the message that starts the work was sent; when it was not, the person can send it themselves. */
  started: boolean
  failure?: string
}

/** The preset library and the presets of stories. Refusals are plain `Error`s with the reason; unknown stories and worlds are not-found errors. */
export class Presets {
  constructor(private readonly deps: PresetDeps) {}

  get maxUploadBytes(): number { return this.deps.maxUploadBytes }

  list(): PresetSummary[] {
    return listPresets(this.deps.root()).map(entry => entry.summary)
  }

  /** A preset with the text of each prompt it carries, keyed `<language>/<id>`. */
  read(name: string): { summary: PresetSummary; prompts: Record<string, string> } {
    const loaded = loadPreset(this.deps.root(), name)
    return { summary: loaded.summary, prompts: Object.fromEntries([...loaded.files].map(([path, text]) => [path.slice(0, -3), text])) }
  }

  async saveFromWorld(request: SavePresetRequest): Promise<PresetSummary> {
    const directory = await this.deps.worldDirectory(request.fromWorld)
    if (directory === undefined) throw new WorldNotFoundError(`there is no world with id "${request.fromWorld}"`)
    return (await savePresetFromWorld(this.deps.root(), directory, request)).summary
  }

  /** Makes a preset from a world's own prose prompts, or from the shipped ones as a starting point when no world is given. */
  async create(request: Omit<SavePresetRequest, 'fromWorld'> & { fromWorld?: string }): Promise<PresetSummary> {
    if (request.fromWorld !== undefined) return await this.saveFromWorld({ ...request, fromWorld: request.fromWorld })
    return (await createPresetFromShipped(this.deps.root(), request)).summary
  }

  async updateInfo(name: string, change: PresetInfoChange): Promise<PresetSummary> {
    return (await updatePresetInfo(this.deps.root(), name, change)).summary
  }

  /** Writes the person's own text of a prompt; `undefined` takes the preset's version out. */
  async writePrompt(name: string, language: string, id: string, text: string | undefined): Promise<PresetSummary> {
    const directory = this.existing(name)
    if (!id.startsWith('roleplay/')) throw new Error(`"${id}" is not a prompt of the story`)
    if (text === undefined) await deleteWorldPrompt(directory, language, id)
    else await writeWorldPrompt(directory, language, id, text)
    return loadPreset(this.deps.root(), name).summary
  }

  /** The prompts holding the rules of the game that the preset does not carry yet, which it may take over from the shipped ones. */
  rulesPrompts(name: string, language: string): string[] {
    return listWorldPrompts(this.existing(name), language).filter(entry => entry.kind === 'rules' && !entry.carried).map(entry => entry.id)
  }

  /** The text of a prompt as a story with this preset gets it: the preset's own, else the shipped one. */
  promptText(name: string, language: string, id: string): string {
    return readWorldPrompt(this.existing(name), language, id).text
  }

  private existing(name: string): string {
    const directory = presetDirectory(this.deps.root(), name)
    if (!existsSync(directory)) throw new Error(`there is no preset "${name}"`)
    return directory
  }

  /** Like `importFile`, under a name made from the title that is not yet taken. */
  async importTitled(title: string, file: Buffer, language?: string): Promise<PresetAuthoringOpened & { name: string }> {
    return await this.importFile(this.freeName(title), file, language, title.trim() === '' ? undefined : title.trim().slice(0, 300))
  }

  private freeName(title: string): string {
    const base = trimCharacters(title.normalize('NFKD').replace(/[^A-Za-z0-9_-]+/g, '-'), '-_').slice(0, 56) || 'preset'
    const taken = new Set(listPresets(this.deps.root()).map(entry => entry.summary.name))
    let name = base
    for (let index = 2; taken.has(name); index += 1) name = `${base}-${index}`
    return name
  }

  /**
   * Imports the chosen prompts of a staged preset as they are, with no assistant: a new library preset is made and holds them as its narration style in every language the program ships, and nothing else happens.
   * @throws {ImportNotFoundError} when the file is no longer staged. @throws {ImportCardError} when the choice cannot be used.
   */
  async importVerbatim(request: SelectionChoice & { name?: string; title?: string }): Promise<{ name: string }> {
    const { file, name: fileName } = this.deps.staging.choose('preset', request)
    const made = verbatimStyle(file, fileName)
    const title = request.title ?? made.name
    const name = request.name ?? this.freeName(title)
    if (!isPresetName(name)) throw new Error(`"${name}" is not a usable preset name (letters, digits, "-" and "_", up to 64)`)
    const root = this.deps.root()
    const directory = await reservePreset(root, name, title, made.sampling)
    try {
      for (const language of shippedLanguages()) await writeWorldPrompt(directory, language, 'roleplay/style', made.text)
    } catch (error) {
      await deletePreset(root, name)
      throw error
    }
    this.deps.staging.discard(request.id)
    return { name }
  }

  /** Opens the authoring chat of a preset. */
  async author(name: string, language?: string): Promise<{ chatSessionId: string }> {
    const loaded = loadPreset(this.deps.root(), name)
    return { chatSessionId: await this.deps.authoring.ensure(name, loaded.summary.title, language) }
  }

  /** Keeps an uploaded SillyTavern preset in a new library preset and has its authoring chat turn it into prompts. @throws {ImportCardError} when the file is not a preset. */
  async importFile(name: string, file: Buffer, language?: string, title?: string): Promise<PresetAuthoringOpened & { name: string }> {
    const uploaded = readStPreset(file, name)
    const root = this.deps.root()
    const directory = await reservePreset(root, name, title ?? uploaded.name, uploaded.sampling)
    try {
      await mkdir(join(directory, IMPORT_FOLDER), { recursive: true })
      await writeFile(join(directory, IMPORT_FOLDER, PRESET_FILE), file)
    } catch (error) {
      await deletePreset(root, name)
      throw error
    }
    const chatSessionId = await this.deps.authoring.ensure(name, title ?? uploaded.name, language)
    let failure: string | undefined
    try { await this.deps.authoring.send(chatSessionId, this.deps.importMessage()) } catch (problem) { failure = problem instanceof Error ? problem.message : String(problem) }
    return { name, chatSessionId, started: failure === undefined, ...(failure === undefined ? {} : { failure }) }
  }

  /** Imports a staged preset with only the prompts the person chose; a name is the library name they gave it, else one is made from the title. @throws {ImportNotFoundError} when the file is no longer staged. */
  async importStaged(request: SelectionChoice & { name?: string; title?: string; language?: string }): Promise<PresetAuthoringOpened & { name: string }> {
    const { file, name: fileName } = this.deps.staging.choose('preset', request)
    const opened = request.name === undefined
      ? await this.importTitled(request.title ?? readStPreset(file, fileName).name, file, request.language)
      : await this.importFile(request.name, file, request.language, request.title)
    this.deps.staging.discard(request.id)
    return opened
  }

  async remove(name: string): Promise<void> {
    await deletePreset(this.deps.root(), name)
  }

  status(session: string): PresetStatus {
    return presetStatus(this.deps.root(), this.folder(session))
  }

  /** Puts the named preset into a story, or takes the story's preset out when no name is given. */
  apply(session: string, name: string | undefined): PresetChange {
    const folder = this.folder(session)
    if (this.deps.playing(session)) throw new PresetBusyError('a turn is being played; change the preset when it is over')
    return { files: switchPreset(this.deps.root(), folder, name) }
  }

  private folder(id: string): string {
    const sessions = `${this.deps.root()}/sessions`
    if (!isSessionId(id) || !existsSync(sessionDatabase(sessions, id))) throw new SessionNotFoundError(`no session "${id}"`)
    return sessionFolder(sessions, id)
  }
}
