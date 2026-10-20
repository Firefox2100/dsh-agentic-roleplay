import { mkdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { LorebookEntry, LorebookSummary, LorebookText } from '../../shared/lorebooks.ts'
import { readLorebook as readStLorebook } from '../import/lorebook.ts'
import { IMPORT_FOLDER } from '../import/store.ts'
import { LOREBOOK_UPLOAD } from '../authoring/lorebook-author-tools.ts'
import { createLorebook, deleteLorebook, deleteLorebookEntry, entriesOf, listLorebooks, loadLorebook, reserveLorebook, updateLorebookInfo, writeLorebookEntry, lorebookDirectory, isLorebookName, type LorebookInfoChange } from './lorebooks.ts'

export interface LorebookDeps {
  /** Read for each call, because the roleplay root can move. */
  root: () => string
  /** Opens the authoring chat of a lorebook and says something in it for the person. */
  authoring: { ensure(name: string, title: string, language?: string): Promise<string>; send(chat: string, text: string): Promise<void> }
  /** The message that has the chat turn the uploaded lorebook into entries. */
  importMessage: () => string
  maxUploadBytes: number
}

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

  /** Opens the authoring chat of a lorebook. */
  async author(name: string, language?: string): Promise<{ chatSessionId: string }> {
    const loaded = await loadLorebook(this.deps.root(), name)
    return { chatSessionId: await this.deps.authoring.ensure(name, loaded.summary.title, language) }
  }

  /** Like `importFile`, under a name made from the title that is not yet taken. */
  async importTitled(title: string, file: Buffer, language?: string): Promise<LorebookAuthoringOpened & { name: string }> {
    const base = title.normalize('NFKD').replace(/[^A-Za-z0-9_-]+/g, '-').replace(/^[-_]+|[-_]+$/g, '').slice(0, 56) || 'lorebook'
    const taken = new Set((await listLorebooks(this.deps.root())).map(book => book.summary.name))
    let name = base
    for (let index = 2; taken.has(name); index += 1) name = `${base}-${index}`
    return await this.importFile(name, file, language, title.trim() === '' ? undefined : title.trim().slice(0, 300))
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
}
