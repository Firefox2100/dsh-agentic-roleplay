import { copyFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { PromptDetail, PromptEntry } from '../../shared/prompts.ts'
import { atomicWrite } from '../atomic-write.ts'
import { LANGUAGE_FOLDER, PROMPTS_FOLDER, listFiles, promptProblem, type PromptLibrary } from './library.ts'

/** A prompt the person asked for does not exist or cannot be written; the message says why. */
export class PromptEditError extends Error {}

const normal = (text: string): string => text.replace(/\r\n/g, '\n').trimEnd()
const VARIABLE = /\$\{([A-Za-z]+)\}/g
const variablesOf = (text: string): string[] => [...new Set([...text.matchAll(VARIABLE)].map(match => match[1] as string))]
const ID = /^[a-z0-9-]+(\/[a-z0-9-]+)*$/

/**
 * The prompts of the roleplay root, for the person to look at and edit: what each file says, whether it differs from the shipped text, the shipped text itself
 * to compare with, and replacing a file by it. Nothing is replaced by itself and no record is kept of what was shipped when, so a different file may be an edit or a
 * shipped text that moved on: the person decides.
 */
export class PromptManager {
  constructor(private readonly library: PromptLibrary, private readonly now: () => Date = () => new Date()) {}

  list(): PromptEntry[] {
    return this.library.languages.flatMap(language => listFiles(join(this.library.shipped, language)).map(id => this.entry(id, language))).sort((a, b) => a.id.localeCompare(b.id) || a.language.localeCompare(b.language))
  }

  /** @throws {PromptEditError} for a prompt the package does not ship. */
  read(id: string, language: string): PromptDetail {
    const shipped = this.shipped(id, language)
    const current = this.current(id, language) ?? shipped
    return { id, language, state: normal(current) === normal(shipped) ? 'default' : 'different', current, shipped, variables: variablesOf(shipped) }
  }

  /** Saves a text as the prompt, keeping the file it replaces in the trash when that was not the shipped text. @throws {PromptEditError} when the text cannot be the prompt or the folder is syncing. */
  async write(id: string, language: string, text: string): Promise<PromptEntry> {
    this.shipped(id, language)
    if (this.library.frozen()) throw new PromptEditError('the prompts are being synced: try again when that is done')
    const problem = text.includes('{{') ? 'holds "{{", which DSH reads as a variable of its own' : promptProblem(language, id, text, this.library.shipped)
    if (problem !== undefined) throw new PromptEditError(`prompt ${id} (${language}) ${problem}`)
    const target = this.file(id, language)
    const body = text.endsWith('\n') ? text : `${text}\n`
    const before = this.current(id, language)
    if (before !== undefined && normal(before) !== normal(body) && normal(before) !== normal(this.shipped(id, language))) this.keep(id, language, target)
    await atomicWrite(target, body, { createDirectory: true })
    return this.entry(id, language)
  }

  /** Puts the shipped text in the file. The file it replaces goes to the trash unless it already was the shipped text. */
  async reset(id: string, language: string): Promise<PromptEntry> {
    return await this.write(id, language, this.shipped(id, language))
  }

  private entry(id: string, language: string): PromptEntry {
    const { state } = this.read(id, language)
    return { id, language, state }
  }

  private shipped(id: string, language: string): string {
    const file = ID.test(id) ? join(this.library.shipped, language, `${id}.md`) : undefined
    if (file === undefined || !LANGUAGE_FOLDER.test(language) || !existsSync(file)) throw new PromptEditError(`there is no shipped prompt "${id}" in "${language}"`)
    return readFileSync(file, 'utf8')
  }

  private file(id: string, language: string): string {
    return join(this.library.directory, language, `${id}.md`)
  }

  private current(id: string, language: string): string | undefined {
    const file = this.file(id, language)
    return existsSync(file) ? readFileSync(file, 'utf8') : undefined
  }

  private keep(id: string, language: string, file: string): void {
    const stamp = this.now().toISOString().replace(/[:.]/g, '-')
    const target = join(dirname(this.library.directory), '.trash', PROMPTS_FOLDER, stamp, language, `${id}.md`)
    mkdirSync(dirname(target), { recursive: true })
    copyFileSync(file, target)
  }
}
