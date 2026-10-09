import { randomUUID } from 'node:crypto'
import { cp, mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { MAX_IMPORT_NAME, type ImportChoices, type ImportPreview, type NormalizedCard, type OpeningChoice } from '../../shared/import-card.ts'
import { InvalidEditProblems } from '../../shared/world-state.ts'

export const IMPORT_FOLDER = '.import'
const CARD_FILE = 'card.json'
const CHOICES_FILE = 'choices.json'
export const PICTURE_FILE = 'picture.png'
const IMPORT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
/** An upload that nobody started an import from is forgotten after this long. */
const ABANDONED_AFTER_MS = 24 * 3_600_000

export class ImportNotFoundError extends Error {}

/** What the person importing is offered to begin with: the card's own name, the entries it left switched on, and its first message (an alternate greeting when it has none). */
export function defaultChoices(card: NormalizedCard): ImportChoices {
  const opening: OpeningChoice = card.firstMessage.trim() !== '' ? { kind: 'first' } : card.alternateGreetings.some(greeting => greeting.trim() !== '') ? { kind: 'alternate', index: card.alternateGreetings.findIndex(greeting => greeting.trim() !== '') } : { kind: 'none' }
  return { name: card.name.slice(0, MAX_IMPORT_NAME), disabledEntries: (card.book?.entries ?? []).filter(entry => !entry.enabled).map(entry => entry.id), opening }
}

/** The text of the opening a choice names; nothing when the choice is none or names nothing. */
export function openingText(card: NormalizedCard, opening: OpeningChoice): string | undefined {
  const found = opening.kind === 'first' ? card.firstMessage : opening.kind === 'alternate' ? card.alternateGreetings[opening.index] : undefined
  return found === undefined || found.trim() === '' ? undefined : found
}

/** Why a set of choices cannot be used for a card; none when it can. */
export function choiceProblems(card: NormalizedCard, choices: ImportChoices): string[] {
  const problems: string[] = []
  if (choices.name.trim() === '') problems.push('the world needs a name')
  if (choices.name.length > MAX_IMPORT_NAME) problems.push(`the name is longer than ${MAX_IMPORT_NAME} characters`)
  const known = new Set((card.book?.entries ?? []).map(entry => entry.id))
  for (const id of choices.disabledEntries) if (!known.has(id)) problems.push(`there is no entry "${id}"`)
  if (choices.opening.kind !== 'none' && openingText(card, choices.opening) === undefined) problems.push('the opening chosen is empty or does not exist')
  return problems
}

/** Reads the choices of a body that came from the browser: every field is checked. */
export function parseChoices(value: unknown): ImportChoices {
  const problems: string[] = []
  const input = typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : undefined
  if (input === undefined) throw new InvalidEditProblems(['the choices must be an object'])
  const name = typeof input['name'] === 'string' ? input['name'].trim() : (problems.push('name must be text'), '')
  const disabled = Array.isArray(input['disabledEntries']) && input['disabledEntries'].every(entry => typeof entry === 'string') ? input['disabledEntries'] as string[] : (problems.push('disabledEntries must be a list of ids'), [])
  const raw = typeof input['opening'] === 'object' && input['opening'] !== null ? input['opening'] as Record<string, unknown> : undefined
  let opening: OpeningChoice = { kind: 'none' }
  if (raw?.['kind'] === 'first') opening = { kind: 'first' }
  else if (raw?.['kind'] === 'alternate' && Number.isInteger(raw['index']) && (raw['index'] as number) >= 0) opening = { kind: 'alternate', index: raw['index'] as number }
  else if (raw?.['kind'] !== 'none') problems.push('opening must be first, alternate with an index, or none')
  if (problems.length > 0) throw new InvalidEditProblems(problems)
  return { name, disabledEntries: [...new Set(disabled)], opening }
}

async function readJson<T>(file: string): Promise<T> {
  return JSON.parse(await readFile(file, 'utf8')) as T
}

/** What an import folder holds: the card as it was read, what the person chose, and the card's picture when it had one. */
export async function readImportFolder(directory: string): Promise<{ card: NormalizedCard; choices: ImportChoices; hasPicture: boolean }> {
  const [card, choices, picture] = await Promise.all([
    readJson<NormalizedCard>(join(directory, CARD_FILE)),
    readJson<ImportChoices>(join(directory, CHOICES_FILE)),
    stat(join(directory, PICTURE_FILE)).then(() => true, () => false),
  ])
  return { card, choices, hasPicture: picture }
}

export async function writeChoices(directory: string, choices: ImportChoices): Promise<void> {
  const file = join(directory, CHOICES_FILE)
  await writeFile(`${file}.writing`, JSON.stringify(choices, null, 2))
  await rename(`${file}.writing`, file)
}

/** Uploaded cards waiting to become worlds: one folder each under `<root>/imports/`. */
export class ImportStore {
  constructor(private readonly root: () => string) {}

  private folder(id: string): string {
    if (!IMPORT_ID.test(id)) throw new ImportNotFoundError(`there is no import "${id}"`)
    return join(this.root(), 'imports', id)
  }

  async create(card: NormalizedCard, picture?: Buffer): Promise<ImportPreview> {
    await this.forgetAbandoned()
    const id = randomUUID()
    const directory = this.folder(id)
    await mkdir(directory, { recursive: true })
    try {
      await writeFile(join(directory, CARD_FILE), JSON.stringify(card))
      if (picture !== undefined) await writeFile(join(directory, PICTURE_FILE), picture)
      await writeChoices(directory, defaultChoices(card))
    } catch (error) {
      await rm(directory, { recursive: true, force: true })
      throw error
    }
    return await this.read(id)
  }

  async read(id: string): Promise<ImportPreview> {
    const directory = this.folder(id)
    try {
      const { card, choices, hasPicture } = await readImportFolder(directory)
      return { id, card, choices, hasAvatar: hasPicture }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw new ImportNotFoundError(`there is no import "${id}"`)
      throw error
    }
  }

  /** The picture of an upload, when it has one. @throws {ImportNotFoundError} when there is no such import or it has no picture. */
  async picture(id: string): Promise<{ file: string; size: number }> {
    const file = join(this.folder(id), PICTURE_FILE)
    try {
      return { file, size: (await stat(file)).size }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw new ImportNotFoundError(`the import "${id}" has no picture`)
      throw error
    }
  }

  /** @throws {InvalidEditProblems} when the choices cannot be used for the card. */
  async choose(id: string, choices: ImportChoices): Promise<ImportPreview> {
    const { card } = await this.read(id)
    const problems = choiceProblems(card, choices)
    if (problems.length > 0) throw new InvalidEditProblems(problems)
    await writeChoices(this.folder(id), choices)
    return await this.read(id)
  }

  async discard(id: string): Promise<void> {
    await this.read(id)
    await rm(this.folder(id), { recursive: true, force: true })
  }

  /** Moves the folder into the world it became, as `.import/`. */
  async adopt(id: string, worldDirectory: string): Promise<void> {
    const from = this.folder(id)
    const to = join(worldDirectory, IMPORT_FOLDER)
    try {
      await rename(from, to)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EXDEV') throw error
      await cp(from, to, { recursive: true })
      await rm(from, { recursive: true, force: true })
    }
  }

  private async forgetAbandoned(): Promise<void> {
    const parent = join(this.root(), 'imports')
    let names: string[]
    try {
      names = await readdir(parent)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return
      throw error
    }
    const limit = Date.now() - ABANDONED_AFTER_MS
    for (const name of names) {
      if (!IMPORT_ID.test(name)) continue
      const { mtimeMs } = await stat(join(parent, name))
      if (mtimeMs < limit) await rm(join(parent, name), { recursive: true, force: true })
    }
  }
}
