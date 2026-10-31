import { cp, mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { languageOf as storyLanguageOf, translator } from 'dsh-roleplay-model'
import type { ImportChoices, NormalizedCard, UpdateStatus, UpdateTarget } from '../../shared/import-card.ts'
import { InvalidEditProblems } from '../../shared/world-state.ts'
import { authoringTitle } from '../agent/authoring-sessions.ts'
import { readImageFileMetadata } from '../images/image-files.ts'
import { CHARACTER_FILE_NAME } from '../characters/character-file.ts'
import { CHARACTERS_DIR } from '../characters/load.ts'
import { referenceImagePath } from '../images/storage.ts'
import { WorldNotFoundError } from '../sessions/errors.ts'
import type { WorldCatalog } from '../worlds/catalog.ts'
import { baseId, cardPieces, UPDATE_FOLDER } from './card-tools.ts'
import { matchPieces, worldFieldChanges } from './card-diff.ts'
import { cardCharacter, writePortrait } from './finish.ts'
import { addressesToFetch, addressKey, candidateUrls, fetchPictures, mergeReports, type PicturesReport } from './pictures.ts'
import { importPhase } from './run-import.ts'
import { editsSince, writeSnapshot } from './snapshot.ts'
import { recordProvenance } from './provenance.ts'
import type { StartedImport, StartImportDeps } from './start-import.ts'
import { IMPORT_FOLDER, PICTURE_FILE, readImportFolder, writeChoices } from './store.ts'
import type { Classified } from './survey.ts'

const PREVIOUS_FOLDER = 'previous'
const CLASSIFICATION = 'classification.json'

const sameName = (a: string, b: string): boolean => a.normalize('NFKC').trim().toLowerCase() === b.normalize('NFKC').trim().toLowerCase()
const exists = (path: string): Promise<boolean> => stat(path).then(() => true, () => false)

/** Whether a world holds the card it was made from and its import is over: the only kind of world a newer card can update. */
async function importedFromCard(directory: string): Promise<boolean> {
  if (!await exists(join(directory, IMPORT_FOLDER, 'card.json'))) return false
  const phase = await importPhase(directory)
  return phase === undefined || phase === 'done'
}

/** What the editor of a world needs to know to offer a card update, or to undo the last one. */
export async function updateStatus(directory: string): Promise<UpdateStatus> {
  return { fromCard: await importedFromCard(directory), revertible: await canRevert(directory), waiting: await pendingUpdate(directory) }
}

/** Whether a newer card is waiting to update the world. */
export const pendingUpdate = (directory: string): Promise<boolean> => exists(join(directory, IMPORT_FOLDER, UPDATE_FOLDER, 'card.json'))

/** How many worlds one upload offers to update: a person with more than this has other things to worry about. */
const MAX_TARGETS = 50

/** The worlds made from a card whose import is over: what a newer card can update, the ones with the card's name first, and whether anyone has changed each since. */
export async function findTargets(worlds: WorldCatalog, name: string): Promise<UpdateTarget[]> {
  const targets: UpdateTarget[] = []
  for (const summary of (await worlds.list()).worlds) {
    const record = await worlds.find(summary.id)
    if (record === undefined || !await importedFromCard(record.directory)) continue
    const edits = await editsSince(record.directory)
    targets.push({ worldId: summary.id, name: summary.name, sameName: sameName(summary.name, name), edited: edits.edited, changes: edits.edited === 'yes' ? edits.changes : [] })
  }
  return targets.sort((a, b) => Number(b.sameName) - Number(a.sameName)).slice(0, MAX_TARGETS)
}

/** The message that sends the authoring chat to bring a world up to date with the newer card; it speaks the person's language, like the import command. */
export function updateMessage(language?: string): string {
  const tr = translator(storyLanguageOf(language))
  return tr('The character card this world was made from has a newer version, kept in this world\'s .import/update folder. Bring the world up to date with it. First call card_diff: it lists what changed between the two versions, which characters, places and things were made from each changed piece, and which files of the world have been edited since the import. Read the pieces you need with card_read (version current is the old card, version new is the new one). Then change only what the new card changed, with your editing tools, and keep what the person has edited since the import. What the card says about the world itself (its description, tags and opening) is changed with edit_world_info. Remove what only a dropped piece made unless the person edited it. Do not add what neither version of the card says. When the world matches the new card, call check_card with version new: it lists what the new card changed that the world does not say yet; deal with each finding or say why you left it. Then call card_update_finish, and tell me briefly what you changed, what you left alone and why.')
}

/**
 * Starts the update of a world from an uploaded card: the card waits in the world's import folder, the world's authoring chat is opened, and it is told to apply the difference.
 * @throws {WorldNotFoundError} when the world is gone. @throws {InvalidEditProblems} when the world was not made from a card, or the choices cannot be used.
 */
export async function startUpdate(deps: StartImportDeps, id: string, choices: ImportChoices, worldId: string, language?: string): Promise<StartedImport> {
  const record = await deps.worlds.find(worldId)
  if (record === undefined) throw new WorldNotFoundError(`there is no world with id "${worldId}"`)
  if (!await importedFromCard(record.directory)) throw new InvalidEditProblems([`the world "${record.summary.name}" was not made from a card, or its import has not finished`])
  await deps.store.choose(id, { ...choices, name: record.summary.name })
  const waiting = join(record.directory, IMPORT_FOLDER, UPDATE_FOLDER)
  if (!await pendingUpdate(record.directory) || !await canRevert(record.directory)) await backUp(record.directory)
  await rm(waiting, { recursive: true, force: true })
  await deps.store.adopt(id, record.directory, join(IMPORT_FOLDER, UPDATE_FOLDER))
  const chatSessionId = await deps.authoring.ensure(record.summary.id, record.summary.name, authoringTitle(record.summary.name, language), language)
  let failure: string | undefined
  try {
    await deps.authoring.send(chatSessionId, updateMessage(language))
  } catch (error) {
    failure = error instanceof Error ? error.message : String(error)
  }
  return { worldId: record.summary.id, chatSessionId, started: failure === undefined, ...(failure === undefined ? {} : { failure }) }
}

const BACKUP_FOLDER = 'before-update'
const NOT_RECORDS = new Set([UPDATE_FOLDER, PREVIOUS_FOLDER, BACKUP_FOLDER])

/** What an update may change of a world: its files. The pictures are made and fetched on their own, and a name that starts with a dot is the program's. */
const isWorldFile = (name: string): boolean => !name.startsWith('.') && name !== 'images'

/** Keeps the world as it is before an update changes it, so the update can be undone as a whole. */
async function backUp(directory: string): Promise<void> {
  const target = join(directory, IMPORT_FOLDER, BACKUP_FOLDER)
  await rm(target, { recursive: true, force: true })
  await mkdir(join(target, 'world'), { recursive: true })
  await mkdir(join(target, 'import'), { recursive: true })
  for (const entry of await readdir(directory)) if (isWorldFile(entry)) await cp(join(directory, entry), join(target, 'world', entry), { recursive: true })
  for (const entry of await readdir(join(directory, IMPORT_FOLDER))) if (!NOT_RECORDS.has(entry)) await cp(join(directory, IMPORT_FOLDER, entry), join(target, 'import', entry), { recursive: true })
}

/** Whether the world was kept as it was before its last update, which is what undoing that update returns it to. */
export const canRevert = (directory: string): Promise<boolean> => exists(join(directory, IMPORT_FOLDER, BACKUP_FOLDER, 'world'))

/**
 * Returns the world to what it was before its last card update, the import's records included. What the world holds now is moved to `.trash` rather than deleted,
 * so edits made after the update can still be found. Pictures are not part of it.
 * @throws {InvalidEditProblems} when there is no update to undo.
 */
export async function revertUpdate(directory: string): Promise<{ keptIn: string }> {
  if (!await canRevert(directory)) throw new InvalidEditProblems(['there is no card update to undo in this world'])
  const backup = join(directory, IMPORT_FOLDER, BACKUP_FOLDER)
  const keptIn = join(directory, '.trash', `update-${new Date().toISOString().replace(/[:.]/g, '-')}`)
  await mkdir(keptIn, { recursive: true })
  for (const entry of await readdir(directory)) if (isWorldFile(entry)) await rename(join(directory, entry), join(keptIn, entry))
  for (const entry of await readdir(join(backup, 'world'))) await cp(join(backup, 'world', entry), join(directory, entry), { recursive: true })
  const folder = join(directory, IMPORT_FOLDER)
  for (const entry of await readdir(folder)) if (!NOT_RECORDS.has(entry)) await rm(join(folder, entry), { recursive: true, force: true })
  for (const entry of await readdir(join(backup, 'import'))) await cp(join(backup, 'import', entry), join(folder, entry), { recursive: true })
  await rm(join(folder, UPDATE_FOLDER), { recursive: true, force: true })
  await rm(join(folder, PREVIOUS_FOLDER), { recursive: true, force: true })
  await rm(backup, { recursive: true, force: true })
  return { keptIn }
}

/** What applying a newer card as the world's source did. */
export interface UpdateOutcome {
  /** Pieces the import's records no longer know, because the card dropped them. */
  forgotten: number
  /** `droppedFromTheCard`: pictures fetched from addresses the newer card no longer has; they stay in the library. */
  pictures: { found: number; added: number; droppedFromTheCard: string[] }
  /** What the card changed in what the world says about itself (description, tags, opening…): the assistant carries it over with edit_world_info, or says it did not. */
  aboutTheWorld: string[]
  /** Whether the card's picture, which is the portrait of its character, was replaced by the new card's. */
  portrait: 'replaced' | 'kept' | 'none'
}

/**
 * The newer card becomes the card the world was made from: the old one is kept in `.import/previous`, the import's record of which piece is what follows the pieces that
 * stayed, and what the world holds now is what a later edit is measured against.
 * @throws {Error} when no newer card is waiting.
 */
export async function finishUpdate(directory: string, options: { signal?: AbortSignal; fetcher?: typeof fetchPictures } = {}): Promise<UpdateOutcome> {
  const folder = join(directory, IMPORT_FOLDER)
  const waiting = join(folder, UPDATE_FOLDER)
  let next: Awaited<ReturnType<typeof readImportFolder>>
  try { next = await readImportFolder(waiting) } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw new Error('no newer version of the card is waiting to update this world')
    throw error
  }
  const current = await readImportFolder(folder)
  const oldPicture = current.hasPicture ? await readFile(join(folder, PICTURE_FILE)) : undefined
  const newPicture = next.hasPicture ? await readFile(join(waiting, PICTURE_FILE)) : undefined
  const forgotten = await followPieces(folder, current.card, current.choices, next.card, next.choices)
  const previous = join(folder, PREVIOUS_FOLDER)
  await rm(previous, { recursive: true, force: true })
  await mkdir(previous, { recursive: true })
  for (const file of ['card.json', 'choices.json', PICTURE_FILE]) await cp(join(folder, file), join(previous, file)).catch((error: NodeJS.ErrnoException) => { if (error.code !== 'ENOENT') throw error })
  await writeFile(join(folder, 'card.json'), JSON.stringify(next.card))
  await writeChoices(folder, next.choices)
  if (next.hasPicture) await cp(join(waiting, PICTURE_FILE), join(folder, PICTURE_FILE))
  else await rm(join(folder, PICTURE_FILE), { force: true })
  await rm(waiting, { recursive: true, force: true })
  const pictures = await updatePictures(directory, current.card.urls ?? [], next.card.urls ?? [], options)
  const portrait = newPicture === undefined ? 'none' : oldPicture !== undefined && oldPicture.equals(newPicture) ? 'kept' : await refreshPortrait(directory, newPicture, next.card.name)
  await recordProvenance(directory, { kind: 'update', card: { name: next.card.name }, language: '' }, await readFile(join(folder, 'card.json'), 'utf8'))
  await writeSnapshot(directory)
  return { forgotten, pictures, aboutTheWorld: worldFieldChanges(current, next).map(change => `${change.field}: ${change.because}`), portrait }
}

/** Fetches what the newer card points to that the world does not have yet, keeps the record of the fetches, and says which fetched pictures the card no longer points to. */
async function updatePictures(directory: string, earlier: readonly string[], later: readonly string[], options: { signal?: AbortSignal; fetcher?: typeof fetchPictures }): Promise<UpdateOutcome['pictures']> {
  const file = join(directory, IMPORT_FOLDER, 'pictures.json')
  const record = await readFile(file, 'utf8').then(text => JSON.parse(text) as PicturesReport, (): undefined => undefined)
  const ask = addressesToFetch(earlier, later, record)
  const report = ask.length === 0 ? undefined : await (options.fetcher ?? fetchPictures)(directory, ask, options.signal === undefined ? {} : { signal: options.signal }).catch((): PicturesReport => ({ found: 0, added: [], skipped: [] }))
  if (report !== undefined && (record !== undefined || report.found > 0)) await writeFile(file, JSON.stringify(mergeReports(record, report, candidateUrls(later).candidates.length)))
  const merged = report === undefined ? record : mergeReports(record, report, 0)
  const pointedTo = new Set(later.map(addressKey))
  const stillWanted = new Set([...(merged?.added ?? []), ...(merged?.skipped ?? []).flatMap(entry => (entry.of === undefined ? [] : [{ url: entry.url, path: entry.of }]))].filter(entry => pointedTo.has(addressKey(entry.url))).map(entry => entry.path))
  const dropped: string[] = []
  for (const entry of record?.added ?? []) if (!stillWanted.has(entry.path) && !dropped.includes(entry.path) && await exists(join(directory, 'images', entry.path))) dropped.push(entry.path)
  return { found: report?.found ?? 0, added: report?.added.length ?? 0, droppedFromTheCard: dropped }
}

/** Carries the import's record of what each piece was over to the new card's piece ids; the pieces the new card dropped are forgotten. */
async function followPieces(folder: string, before: NormalizedCard, beforeChoices: ImportChoices, after: NormalizedCard, afterChoices: ImportChoices): Promise<number> {
  const file = join(folder, CLASSIFICATION)
  let classified: Classified
  try { classified = JSON.parse(await readFile(file, 'utf8')) as Classified } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return 0
    throw error
  }
  const match = matchPieces(cardPieces(before, beforeChoices), cardPieces(after, afterChoices))
  const renamed = new Map(match.pairs.map(pair => [pair.before.id, pair.after.id]))
  const dropped = new Set(match.removed.map(piece => piece.id))
  const followed: Classified = {}
  let forgotten = 0
  for (const [key, value] of Object.entries(classified)) {
    const base = baseId(key)
    if (dropped.has(base)) { forgotten += 1; continue }
    followed[`${renamed.get(base) ?? base}${key.slice(base.length)}`] = value
  }
  const temporary = `${file}.tmp`
  await writeFile(temporary, JSON.stringify(followed))
  await rename(temporary, file)
  return forgotten
}

/** Replaces the portrait that came with the card by the new card's picture, unless the person has put another there; a card portrait the world never got is made now. */
async function refreshPortrait(directory: string, picture: Buffer, cardName: string): Promise<'replaced' | 'kept'> {
  const characters = join(directory, CHARACTERS_DIR)
  const documents: Record<string, unknown>[] = []
  for (const entry of await readdir(characters).catch((): string[] => [])) {
    const document = await readFile(join(characters, entry, CHARACTER_FILE_NAME), 'utf8').then(text => JSON.parse(text) as Record<string, unknown>, (): undefined => undefined)
    if (document !== undefined) documents.push({ ...document, id: document['id'] ?? entry })
  }
  for (const document of documents) {
    const file = referenceImagePath(directory, { kind: 'character', localId: String(document['id']) })
    const made = await readImageFileMetadata(file)
    if (made?.origin === 'uploaded' && made.originalName === PICTURE_FILE) return await writePortrait(directory, picture, [document], String(document['name'])) ? 'replaced' : 'kept'
  }
  const character = cardCharacter(documents, cardName)
  if (character === undefined || await exists(referenceImagePath(directory, { kind: 'character', localId: String(character['id']) }))) return 'kept'
  return await writePortrait(directory, picture, documents, cardName) ? 'replaced' : 'kept'
}
