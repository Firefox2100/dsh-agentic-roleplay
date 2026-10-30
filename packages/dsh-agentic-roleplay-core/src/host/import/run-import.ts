import { readFile, rename, rm } from 'node:fs/promises'
import { join } from 'node:path'

import type { NormalizedCard } from '../../shared/import-card.ts'
import { extractCasting } from './casting.ts'
import { emptyExtracted, extractEntities, extractStyle, extractVariables, type Extracted } from './extract.ts'
import { finishImport, type ImportReport } from './finish.ts'
import { itemise, type SourceItem } from './items.ts'
import type { ImportContext } from './run.ts'
import { fetchPictures, type PicturesReport } from './pictures.ts'
import { IMPORT_FOLDER, PICTURE_FILE, readImportFolder } from './store.ts'
import { writeSnapshot } from './snapshot.ts'
import { recordProvenance } from './provenance.ts'
import { buildRoster, classifyItems, isLeftOut, ROLES, type Classified, type Role, type Roster } from './survey.ts'
import { atomicWriteJson } from '../atomic-write.ts'
import { checkWorld, type WorldCheck } from '../worlds/world-check.ts'
import { isDraftWorld } from '../worlds/draft.ts'

/** The import in a world is not in the state the step needs, or there is none. The message says what to do. */
export class ImportStateError extends Error {}

export const PHASES = ['ready', 'surveyed', 'built', 'repair', 'done'] as const
export type Phase = typeof PHASES[number]

const STATE = 'state.json'
const CLASSIFICATION = 'classification.json'
const ROSTER = 'roster.json'
const EXTRACTED = 'extracted.json'
const PREVIOUS_EXTRACTED = 'extracted.previous.json'
const REPORT = 'report.json'
const PICTURES = 'pictures.json'

const folder = (world: string): string => join(world, IMPORT_FOLDER)

async function readJson<T>(file: string): Promise<T> {
  return JSON.parse(await readFile(file, 'utf8')) as T
}

const writeJson = (file: string, value: unknown): Promise<void> => atomicWriteJson(file, value, { createDirectory: true })

const fetching = new Map<string, Promise<PicturesReport>>()

/**
 * Starts fetching the pictures the card points to, next to the work of the agents, once per import; a later call gets the same run or its saved result.
 * A failure is a report of its own: pictures never stop an import.
 */
function ensurePictures(world: string, urls: readonly string[]): Promise<PicturesReport> {
  const running = fetching.get(world)
  if (running !== undefined) return running
  const run = (async (): Promise<PicturesReport> => {
    try { return await readJson<PicturesReport>(join(folder(world), PICTURES)) } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
    const report = await fetchPictures(world, urls).catch((error: unknown): PicturesReport => ({ found: 0, added: [], skipped: [{ url: '', reason: error instanceof Error ? error.message : String(error) }] }))
    await writeJson(join(folder(world), PICTURES), report)
    return report
  })()
  fetching.set(world, run)
  run.catch(() => fetching.delete(world))
  return run
}

/** How far the import of a world has come; nothing when the world holds no card waiting to be imported. */
export async function importPhase(world: string): Promise<Phase | undefined> {
  try {
    const state = await readJson<{ phase: Phase }>(join(folder(world), STATE))
    return PHASES.includes(state.phase) ? state.phase : undefined
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw error
  }
}

/** Whether the import has just finished and its turn may still correct the world with the editing tools, without asking. */
export async function isReviewing(world: string): Promise<boolean> {
  try {
    return (await readJson<{ reviewing?: boolean }>(join(folder(world), STATE))).reviewing === true
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
    throw error
  }
}

/** The import turn is over: the world is edited like any other from now on, and what it holds now is what a later edit is measured against. */
export async function endReview(world: string): Promise<void> {
  if (!await isReviewing(world)) return
  // a world that still would not start stays a draft (and is not yet measured against: its files are still being repaired)
  if ((await checkWorld({ directory: world, summary: { name: 'the world' } as never })).ok) await finishedImport(world)
  else await writeJson(join(folder(world), STATE), { phase: 'repair' })
}

async function finishedImport(world: string): Promise<void> {
  await writeJson(join(folder(world), STATE), { phase: 'done' })
  await writeSnapshot(world)
}

/** The person asked for a draft to be repaired: until the turn ends the assistant edits the world without asking, as it does in the review that follows an import. */
export async function startRepair(world: string): Promise<void> {
  if (await importPhase(world) === 'repair') await writeJson(join(folder(world), STATE), { phase: 'repair', reviewing: true })
}

/** A draft that has been repaired since (by the assistant or the person) becomes an ordinary world; one that still has problems stays as it is. @returns whether it is a world now. */
export async function settleDraft(world: string): Promise<boolean> {
  if (await importPhase(world) !== 'repair') return false
  if (!(await checkWorld({ directory: world, summary: { name: 'the world' } as never })).ok) return false
  await finishedImport(world)
  return true
}

/** The person accepts the draft as it is, problems included: it is an ordinary world from now on, which cannot be played until it is mended. */
export async function keepDraft(world: string): Promise<void> {
  if (await importPhase(world) !== 'repair') throw new ImportStateError('this world is not a draft')
  await finishedImport(world)
}

/** Whether the world is an import that was written but would not start yet. */
export async function isDraft(world: string): Promise<boolean> {
  return await isDraftWorld(world)
}

/** Marks a folder that was just moved into a world as an import that is ready to run. */
export async function markReady(world: string): Promise<void> {
  await writeJson(join(folder(world), STATE), { phase: 'ready' })
}

async function need(world: string, phases: readonly Phase[], step: string): Promise<Phase> {
  const phase = await importPhase(world)
  if (phase === undefined) throw new ImportStateError('no card is waiting to be imported in this world')
  if (!phases.includes(phase)) throw new ImportStateError(`${step} cannot run now: the import is at "${phase}"${phases.length === 0 ? '' : `; it needs "${phases.join('" or "')}"`}`)
  return phase
}

async function load(world: string): Promise<{ card: NormalizedCard; items: SourceItem[]; choices: Awaited<ReturnType<typeof readImportFolder>>['choices']; picture: boolean }> {
  const { card, choices, hasPicture } = await readImportFolder(folder(world))
  return { card, choices, items: itemise(card, choices), picture: hasPicture }
}

export interface SurveySummary {
  pieces: number
  roles: Partial<Record<Role, number>>
  leftOut: number
  roster: { characters: string[]; places: string[]; factions: string[]; things: string[] }
  playable: string | undefined
  notes: string[]
}

/** First step: say what each piece of the card is, and list who and what the world is made of. */
export async function survey(ctx: ImportContext, world: string): Promise<SurveySummary> {
  await need(world, ['ready', 'surveyed', 'built'], 'the survey')
  const { card, items } = await load(world)
  void ensurePictures(world, card.urls ?? [])
  const { classified, failures, decided } = await classifyItems(ctx, card, items)
  if (items.length > 0 && failures.length >= items.length && decided === 0) throw new Error(`no piece of the card could be read, so nothing was imported: ${failures[0]}`)
  const { roster, failure } = await buildRoster(ctx, card, items.filter(item => !isLeftOut(classified[item.id]!)), classified)
  if (ctx.cancelled?.() === true) throw new Error('the survey was stopped before it was done, so what it made is not kept')
  await writeJson(join(folder(world), CLASSIFICATION), classified)
  await writeJson(join(folder(world), ROSTER), roster)
  await rm(join(folder(world), EXTRACTED), { force: true })
  await writeJson(join(folder(world), STATE), { phase: 'surveyed' })
  const roles: Partial<Record<Role, number>> = {}
  for (const item of items) { const first = classified[item.id]?.roles[0]; if (first !== undefined) roles[first] = (roles[first] ?? 0) + 1 }
  const names = (kind: string): string[] => roster.filter(entity => entity.kind === kind).map(entity => entity.name)
  return {
    pieces: items.length,
    roles: Object.fromEntries(ROLES.filter(role => roles[role] !== undefined).map(role => [role, roles[role]])) as Partial<Record<Role, number>>,
    leftOut: items.filter(item => isLeftOut(classified[item.id]!)).length,
    roster: { characters: names('character'), places: names('place'), factions: names('faction'), things: names('thing') },
    playable: roster.find(entity => entity.player)?.name,
    notes: [...failures, ...(decided === 0 ? [] : [`the decision model settled ${decided} of ${items.length} pieces as instructions or notes, without asking the language model`]), ...(failure === undefined ? [] : [failure])],
  }
}

export interface BuildSummary {
  characters: number
  places: number
  factions: number
  things: number
  lore: number
  /** The prose prompts the card's instructions became. */
  prompts: string[]
  /** How many variables the card's panels and meters became. */
  variables: number
  notes: string[]
}

/** Second step: write every character, place, faction, thing and background entry from the pieces that are about it. */
export async function build(ctx: ImportContext, world: string): Promise<BuildSummary> {
  await need(world, ['surveyed', 'built'], 'the build')
  const { card, items } = await load(world)
  void ensurePictures(world, card.urls ?? [])
  const classified = await readJson<Classified>(join(folder(world), CLASSIFICATION))
  const roster = await readJson<Roster>(join(folder(world), ROSTER))
  const extracted = await extractEntities(ctx, card, items.filter(item => !isLeftOut(classified[item.id]!)), classified, roster)
  const style = await extractStyle(ctx, card, items, classified)
  extracted.prompts.push(...style.prompts)
  extracted.notes.push(...style.notes)
  const tracked = await extractVariables(ctx, card, items, classified, roster)
  extracted.variables.push(...tracked.variables)
  extracted.notes.push(...tracked.notes)
  const cast = await extractCasting(ctx, card, extracted.casting)
  extracted.commands.push(...cast.commands)
  extracted.triggers.push(...cast.triggers)
  extracted.notes.push(...cast.notes)
  if (ctx.cancelled?.() === true) throw new Error('the build was stopped before it was done, so what it made is not kept')
  // the extraction that was there is kept beside the new one: a run whose jobs mostly failed must not be the only copy of a good one
  await rename(join(folder(world), EXTRACTED), join(folder(world), PREVIOUS_EXTRACTED)).catch((error: NodeJS.ErrnoException) => { if (error.code !== 'ENOENT') throw error })
  await writeJson(join(folder(world), EXTRACTED), extracted)
  await writeJson(join(folder(world), STATE), { phase: 'built' })
  return { characters: extracted.characters.length, places: extracted.locations.length, factions: extracted.factions.length, things: extracted.items.length, lore: extracted.lore.length, prompts: extracted.prompts.map(entry => entry.id), variables: extracted.variables.length, notes: extracted.notes }
}

/** Last step: write the staged world and check it as a whole; a world that cannot start yet is kept as a repairable draft. */
export async function finish(ctx: ImportContext, world: string): Promise<{ ok: true; report: ImportReport; draft?: WorldCheck } | { ok: false; problems: string[] }> {
  await need(world, ['built'], 'the finish')
  const { card, choices, items, picture } = await load(world)
  const classified = await readJson<Classified>(join(folder(world), CLASSIFICATION))
  const roster = await readJson<Roster>(join(folder(world), ROSTER))
  const extracted = { ...emptyExtracted(), ...await readJson<Partial<Extracted>>(join(folder(world), EXTRACTED)).catch(() => ({})) }
  const pictures = await ensurePictures(world, card.urls ?? [])
  const result = await finishImport(ctx, {
    directory: world, card, choices, roster, items, classified, extracted,
    ...(picture ? { picture: await readFile(join(folder(world), PICTURE_FILE)) } : {}), notes: [], pictures: { found: pictures.found, added: pictures.added.length },
  })
  if (result.ok) {
    await writeJson(join(folder(world), STATE), { phase: result.draft === undefined ? 'done' : 'repair', reviewing: true })
    await recordProvenance(world, { kind: 'import', card: { name: card.name }, language: ctx.language ?? '', counts: result.report.counts, notes: result.report.notes.length }, await readFile(join(folder(world), 'card.json'), 'utf8'))
  }
  return result
}

/** What the last finished import reported, or nothing. */
export async function lastReport(world: string): Promise<ImportReport | undefined> {
  try {
    return await readJson<ImportReport>(join(folder(world), REPORT))
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw error
  }
}
