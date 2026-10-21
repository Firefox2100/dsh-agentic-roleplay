import { mkdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { trimCharacters } from '../../shared/text.ts'
import type { SelectionChoice } from '../../shared/import-selection.ts'
import type { ImportStaging } from '../import/staging.ts'
import type { LorebookEntry, LorebookStatus, LorebookSummary, LorebookText } from '../../shared/lorebooks.ts'
import { readLorebook as readStLorebook } from '../import/lorebook.ts'
import { IMPORT_FOLDER } from '../import/store.ts'
import type { Session } from '@dsh-agentic-roleplay/state'
import { addLorebook, lorebooksOf, removeLorebook } from './story.ts'
import { LOREBOOK_UPLOAD } from '../authoring/lorebook-author-tools.ts'
import { verbatimEntries, type VerbatimKnownBy } from './verbatim.ts'
import { addLorebookEntries, createLorebook, deleteLorebook, deleteLorebookEntry, entriesOf, listLorebooks, loadLorebook, reserveLorebook, updateLorebookInfo, writeLorebookEntry, lorebookDirectory, isLorebookName, type LorebookInfoChange } from './lorebooks.ts'

export interface LorebookDeps {
  /** Read for each call, because the roleplay root can move. */
  root: () => string
  /** Opens the authoring chat of a lorebook and says something in it for the person. */
  authoring: { ensure(name: string, title: string, language?: string): Promise<string>; send(chat: string, text: string): Promise<void> }
  /** The message that has the chat turn the uploaded lorebook into entries. */
  importMessage: () => string
  maxUploadBytes: number
  /** Files waiting for the person to choose what of them is imported. */
  staging: ImportStaging
  /** The state of a story. @throws {SessionNotFoundError} when there is none. */
  session: (id: string) => Session
  /** Whether a turn of the story is being played, when its lore must not change. */
  playing: (session: string) => boolean
}

/** The story's lore cannot change right now. */
export class LorebookBusyError extends Error {}

export interface LorebookAuthoringOpened {
  chatSessionId: string
  /** Whether the message that starts the work was sent; when it was not, the person can send it themselves. */
  started: boolean
  failure?: string
}

/** The lorebook library. Refusals are plain `Error`s with the reason. */
export class Lorebooks {
  constructor(private readonly deps: LorebookDeps) {}

  get maxUploadBytes(): number { return this.deps.maxUploadBytes }

  async list(): Promise<LorebookSummary[]> {
    return (await listLorebooks(this.deps.root())).map(book => book.summary)
  }

  async read(name: string): Promise<LorebookText> {
    const book = await loadLorebook(this.deps.root(), name)
    return { summary: book.summary, entries: entriesOf(book) }
  }

  async create(request: { name: string; title?: string; description?: string }): Promise<LorebookSummary> {
    return (await createLorebook(this.deps.root(), request)).summary
  }

  async updateInfo(name: string, change: LorebookInfoChange): Promise<LorebookSummary> {
    return (await updateLorebookInfo(this.deps.root(), name, change)).summary
  }

  async writeEntry(name: string, entry: LorebookEntry): Promise<LorebookSummary> {
    return (await writeLorebookEntry(this.deps.root(), name, entry)).summary
  }

  async removeEntry(name: string, id: string): Promise<LorebookSummary> {
    return (await deleteLorebookEntry(this.deps.root(), name, id)).summary
  }

  async remove(name: string): Promise<void> {
    await deleteLorebook(this.deps.root(), name)
  }

  /** The lorebooks a story holds, and the library to choose from. */
  async status(id: string): Promise<LorebookStatus> {
    return { applied: lorebooksOf(this.deps.session(id)), available: await this.list() }
  }

  /** Copies a library lorebook into a story that is being played; the notes tell what could not be carried over. */
  async addToStory(id: string, name: string): Promise<{ entries: number; notes: string[] }> {
    const session = this.deps.session(id)
    this.assertIdle(id)
    const { applied, notes } = await addLorebook(this.deps.root(), session, name)
    return { entries: applied.entries, notes }
  }

  /** Takes a lorebook out of a story that is being played. */
  removeFromStory(id: string, name: string): { removed: number } {
    const session = this.deps.session(id)
    this.assertIdle(id)
    return { removed: removeLorebook(session, name) }
  }

  private assertIdle(id: string): void {
    if (this.deps.playing(id)) throw new LorebookBusyError('a turn is being played; change the lorebooks when it is over')
  }

  /** Opens the authoring chat of a lorebook. */
  async author(name: string, language?: string): Promise<{ chatSessionId: string }> {
    const loaded = await loadLorebook(this.deps.root(), name)
    return { chatSessionId: await this.deps.authoring.ensure(name, loaded.summary.title, language) }
  }

  /** Like `importFile`, under a name made from the title that is not yet taken. */
  async importTitled(title: string, file: Buffer, language?: string): Promise<LorebookAuthoringOpened & { name: string }> {
    return await this.importFile(await this.freeName(title), file, language, title.trim() === '' ? undefined : title.trim().slice(0, 300))
  }

  /** A library name made from a title that no lorebook has yet. */
  private async freeName(title: string): Promise<string> {
    const base = trimCharacters(title.normalize('NFKD').replace(/[^A-Za-z0-9_-]+/g, '-'), '-_').slice(0, 56) || 'lorebook'
    const taken = new Set((await listLorebooks(this.deps.root())).map(book => book.summary.name))
    let name = base
    for (let index = 2; taken.has(name); index += 1) name = `${base}-${index}`
    return name
  }

  /** Keeps an uploaded SillyTavern lorebook in a new library lorebook and has its authoring chat turn it into entries. @throws {ImportCardError} when the file is not a lorebook. */
  async importFile(name: string, file: Buffer, language?: string, title?: string): Promise<LorebookAuthoringOpened & { name: string }> {
    if (!isLorebookName(name)) throw new Error(`"${name}" is not a usable lorebook name (letters, digits, "-" and "_", up to 64)`)
    const uploaded = readStLorebook(file, name)
    const root = this.deps.root()
    const directory = await reserveLorebook(root, name, title ?? uploaded.name)
    try {
      await mkdir(join(directory, IMPORT_FOLDER), { recursive: true })
      await writeFile(join(directory, LOREBOOK_UPLOAD), file)
    } catch (error) {
      await rm(lorebookDirectory(root, name), { recursive: true, force: true })
      throw error
    }
    const chatSessionId = await this.deps.authoring.ensure(name, title ?? uploaded.name, language)
    let failure: string | undefined
    try { await this.deps.authoring.send(chatSessionId, this.deps.importMessage()) } catch (problem) { failure = problem instanceof Error ? problem.message : String(problem) }
    return { name, chatSessionId, started: failure === undefined, ...(failure === undefined ? {} : { failure }) }
  }

  /** Imports a staged lorebook with only the entries the person chose; a name is the library name they gave it, else one is made from the title. @throws {ImportNotFoundError} when the file is no longer staged. */
  async importStaged(request: SelectionChoice & { name?: string; title?: string; language?: string }): Promise<LorebookAuthoringOpened & { name: string }> {
    const { file, name: fileName } = this.deps.staging.choose('lorebook', request)
    const opened = request.name === undefined
      ? await this.importTitled(request.title ?? readStLorebook(file, fileName).name, file, request.language)
      : await this.importFile(request.name, file, request.language, request.title)
    this.deps.staging.discard(request.id)
    return opened
  }

  /**
   * Imports the chosen entries of a staged lorebook as they are, with no assistant: a new library lorebook is made and filled at once, and nothing else happens.
   * @throws {ImportNotFoundError} when the file is no longer staged. @throws {ImportCardError} when the choice cannot be used.
   */
  async importVerbatim(request: SelectionChoice & { name?: string; title?: string; knownBy: VerbatimKnownBy }): Promise<{ name: string; entries: number }> {
    const { file, name: fileName } = this.deps.staging.choose('lorebook', request)
    const made = verbatimEntries(file, fileName, request.knownBy)
    const title = request.title ?? made.name
    const name = request.name ?? await this.freeName(title)
    if (!isLorebookName(name)) throw new Error(`"${name}" is not a usable lorebook name (letters, digits, "-" and "_", up to 64)`)
    const root = this.deps.root()
    await reserveLorebook(root, name, title)
    try { await addLorebookEntries(root, name, made.entries) } catch (error) { await rm(lorebookDirectory(root, name), { recursive: true, force: true }); throw error }
    this.deps.staging.discard(request.id)
    return { name, entries: made.entries.length }
  }
}
