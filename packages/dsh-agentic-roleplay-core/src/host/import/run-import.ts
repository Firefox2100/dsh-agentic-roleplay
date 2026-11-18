import { readFile, rename, rm } from 'node:fs/promises'
import { join } from 'node:path'

import type { NormalizedCard } from '../../shared/import-card.ts'
import { structureOnly } from './structure.ts'
import { shippedText } from '../prompts/library.ts'
import { emptyExtracted, type Extracted } from './extract.ts'
import { describePieces, describeSurvey, editSurvey, type SurveyEdit } from './survey-edit.ts'
import { STAGES, STAGE_NEEDS, clearStages, complete, mergedStages, produce, readRevision, readStage, statusOf, surveyEdited, surveyMade, withGuidance, writeStage, type Stage, type StageStatus } from './stages.ts'
import { finishImport, type ImportReport } from './finish.ts'
import { itemise, type SourceItem } from './items.ts'
import type { ImportContext } from './run.ts'
import { pieceFinder } from './card-tools.ts'
import { fetchPictures, type PicturesReport } from './pictures.ts'
import { IMPORT_FOLDER, PICTURE_FILE, readImportFolder } from './store.ts'
import { writeSnapshot } from './snapshot.ts'
import { recordProvenance } from './provenance.ts'
import { checkImported } from '../checks/imported.ts'
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
/** The addresses to download pictures from: none when the person turned downloading off. */
function picturesToFetch(card: NormalizedCard, choices: { fetchPictures?: boolean }): string[] {
  return choices.fetchPictures === false ? [] : card.urls ?? []
}

function ensurePictures(world: string, urls: readonly string[], piecesOf: (url: string) => string[]): Promise<PicturesReport> {
  const running = fetching.get(world)
  if (running !== undefined) return running
  const run = (async (): Promise<PicturesReport> => {
    try { return await readJson<PicturesReport>(join(folder(world), PICTURES)) } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
    const report = await fetchPictures(world, urls, { piecesOf }).catch((error: unknown): PicturesReport => ({ found: 0, added: [], skipped: [{ url: '', reason: error instanceof Error ? error.message : String(error) }] }))
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
  const { card, items, choices } = await load(world)
  void ensurePictures(world, picturesToFetch(card, choices), pieceFinder(card, choices))
  const { classified, failures, decided } = await classifyItems(ctx, card, items)
  if (items.length > 0 && failures.length >= items.length && decided === 0) throw new Error(`no piece of the card could be read, so nothing was imported: ${failures[0]}`)
  const { roster, failure } = await buildRoster(ctx, card, items.filter(item => !isLeftOut(classified[item.id]!)), classified)
  if (ctx.cancelled?.() === true) throw new Error('the survey was stopped before it was done, so what it made is not kept')
  await writeJson(join(folder(world), CLASSIFICATION), classified)
  await writeJson(join(folder(world), ROSTER), roster)
  await rm(join(folder(world), EXTRACTED), { force: true })
  await clearStages(world)
  await surveyMade(world)
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

export interface StageReport {
  stage: Stage
  /** What the stage staged, by kind of document. */
  counts: Record<string, number>
  /** The names of what it staged (the first ones). */
  staged: string[]
  /** Why something was left out or failed, and what the stage was unsure of (the first ones). */
  notes: string[]
  notesTotal: number
  guidance?: string
  /** The stages that have not run yet, and those that have to run again. */
  left: Stage[]
  stale: Stage[]
  /** Every stage has run on the survey as it is: the world can be written. */
  complete: boolean
}

const REPORT_NAMES = 40
const REPORT_NOTES = 20
const nameOf = (document: Record<string, unknown>): string => String(document['name'] ?? document['id'] ?? document['key'] ?? '')

async function stageReport(world: string, stage: Stage): Promise<StageReport> {
  const status = await statusOf(world)
  const record = await readStage(world, stage)
  const extracted = record?.extracted ?? {}
  const documents = [extracted.locations, extracted.characters, extracted.factions, extracted.items, extracted.lore, extracted.variables, extracted.commands, extracted.triggers].flatMap(group => group ?? [])
  const staged = [...documents.map(nameOf), ...(extracted.prompts ?? []).map(prompt => prompt.id)].filter(name => name !== '')
  const notes = extracted.notes ?? []
  const entry = status.find(each => each.stage === stage)!
  return {
    stage, counts: entry.counts, staged: staged.slice(0, REPORT_NAMES), notes: notes.slice(0, REPORT_NOTES), notesTotal: notes.length,
    ...(record?.guidance === undefined ? {} : { guidance: record.guidance }),
    left: status.filter(each => each.state === 'todo').map(each => each.stage), stale: status.filter(each => each.state === 'stale').map(each => each.stage), complete: complete(status),
  }
}

/** What every stage has done: which are done, which are still to run and which have to run again. */
export async function importStatus(world: string): Promise<{ phase: Phase | undefined; stages: StageStatus[]; complete: boolean }> {
  const stages = await statusOf(world)
  return { phase: await importPhase(world), stages, complete: complete(stages) }
}

const running = new Set<string>()

/**
 * Writes one stage's documents from the survey as it is now (an answered job is not asked again; with `guidance` the jobs are new ones), keeps them in `.import/stages/`, and makes the whole extraction
 * from every stage that has run. When every stage has run on the current survey the import is `built` and can be written as a world.
 */
export async function runStage(ctx: ImportContext, world: string, stage: Stage, guidance?: string): Promise<StageReport> {
  await need(world, ['surveyed', 'built'], `the stage "${stage}"`)
  const key = `${world}:${stage}`
  if (running.has(key)) throw new ImportStateError(`the stage "${stage}" is already running`)
  const status = await statusOf(world)
  for (const needed of STAGE_NEEDS[stage]) {
    const dependency = status.find(entry => entry.stage === needed)
    if (dependency?.state !== 'done') throw new ImportStateError(`the stage "${stage}" needs the stage "${needed}" first${dependency?.state === 'stale' ? ', and that stage is stale' : ''}`)
  }
  running.add(key)
  try {
    const { card, items, choices } = await load(world)
    void ensurePictures(world, picturesToFetch(card, choices), pieceFinder(card, choices))
    const classified = await readJson<Classified>(join(folder(world), CLASSIFICATION))
    const roster = await readJson<Roster>(join(folder(world), ROSTER))
    const background = STAGE_NEEDS[stage].includes('background') ? (await readStage(world, 'background'))?.extracted : undefined
    const extracted = await produce(stage, withGuidance(ctx, guidance), { card, items, classified, roster, background })
    if (ctx.cancelled?.() === true) throw new Error(`the stage "${stage}" was stopped before it was done, so what it made is not kept`)
    const { revision } = await readRevision(world)
    const needs = Object.fromEntries(await Promise.all(STAGE_NEEDS[stage].map(async needed => [needed, (await readStage(world, needed))!.at])))
    await writeStage(world, { stage, at: new Date().toISOString(), revision, ...(STAGE_NEEDS[stage].length === 0 ? {} : { needs }), ...(guidance === undefined || guidance.trim() === '' ? {} : { guidance: guidance.trim() }), extracted })
    await settleBuild(world)
    return await stageReport(world, stage)
  } finally {
    running.delete(key)
  }
}

/** The extraction of every stage that has run is kept as one; the import is `built` when they all have run on the survey as it is. */
async function settleBuild(world: string): Promise<void> {
  const { items } = await load(world)
  const classified = await readJson<Classified>(join(folder(world), CLASSIFICATION))
  const roster = await readJson<Roster>(join(folder(world), ROSTER))
  const merged = await mergedStages(world, items.filter(item => !isLeftOut(classified[item.id]!)), classified, roster)
  // the extraction that was there is kept beside the new one: a run whose jobs mostly failed must not be the only copy of a good one
  await rename(join(folder(world), EXTRACTED), join(folder(world), PREVIOUS_EXTRACTED)).catch((error: NodeJS.ErrnoException) => { if (error.code !== 'ENOENT') throw error })
  await writeJson(join(folder(world), EXTRACTED), merged)
  await writeJson(join(folder(world), STATE), { phase: complete(await statusOf(world)) ? 'built' : 'surveyed' })
}

export interface SurveyView {
  revision: number
  /** The survey was changed by hand after the model made it. */
  edited: boolean
  roles: Record<string, number>
  entities?: object[]
  pieces?: object[]
  unsure: string[]
  more?: number
}

const SURVEY_PAGE = 60

/** The survey as it stands: its entities with the pieces each is written from, or its pieces with what each was taken to be, a page at a time. */
export async function showSurvey(world: string, what: 'entities' | 'pieces', offset = 0): Promise<SurveyView> {
  await need(world, ['surveyed', 'built'], 'showing the survey')
  const { items } = await load(world)
  const survey = { classified: await readJson<Classified>(join(folder(world), CLASSIFICATION)), roster: await readJson<Roster>(join(folder(world), ROSTER)) }
  const { revision, edited } = await readRevision(world)
  const described = describeSurvey(survey, items)
  const list = what === 'entities' ? described.entities : describePieces(survey, items)
  const page = list.slice(Math.max(0, offset), Math.max(0, offset) + SURVEY_PAGE)
  const left = list.length - Math.max(0, offset) - page.length
  return { revision, edited, roles: described.pieceRoles, [what]: page, unsure: described.unsure.slice(0, 40), ...(left > 0 ? { more: left } : {}) } as SurveyView
}

/** Changes the survey as the person asks (all changes or none). The stages that read the survey before are stale from now on, and the import is no longer ready to be written. */
export async function changeSurvey(world: string, edits: readonly SurveyEdit[]): Promise<{ done: string[]; stale: Stage[] }> {
  await need(world, ['surveyed', 'built'], 'changing the survey')
  const { items } = await load(world)
  const before = { classified: await readJson<Classified>(join(folder(world), CLASSIFICATION)), roster: await readJson<Roster>(join(folder(world), ROSTER)) }
  const { survey, done } = editSurvey(before, edits, new Set(items.map(item => item.id)))
  await writeJson(join(folder(world), CLASSIFICATION), survey.classified)
  await writeJson(join(folder(world), ROSTER), survey.roster)
  await surveyEdited(world)
  await writeJson(join(folder(world), STATE), { phase: 'surveyed' })
  return { done, stale: (await statusOf(world)).filter(entry => entry.state === 'stale').map(entry => entry.stage) }
}

const STAGE_KIND = { places: 'place', characters: 'character', factions: 'faction', things: 'thing' } as const
const STAGE_GROUP = { places: 'locations', characters: 'characters', factions: 'factions', things: 'items' } as const

/** What a stage left out, without a model: the entities of its kind that have no document, and the notes the run made. */
export async function auditStage(world: string, stage: Stage): Promise<{ stage: Stage; state: string; missing: string[]; notes: string[] }> {
  await need(world, ['surveyed', 'built'], 'the audit')
  const record = await readStage(world, stage)
  const status = (await statusOf(world)).find(entry => entry.stage === stage)!
  if (record === undefined) return { stage, state: 'not run yet', missing: [], notes: [] }
  const kind = (STAGE_KIND as Record<string, 'place' | 'character' | 'faction' | 'thing'>)[stage]
  const roster = await readJson<Roster>(join(folder(world), ROSTER))
  const made = new Set((record.extracted[(STAGE_GROUP as Record<string, 'locations' | 'characters' | 'factions' | 'items'>)[stage] ?? 'items'] ?? []).map(document => String(document['id'] ?? '')))
  const missing = kind === undefined ? [] : roster.filter(entity => entity.kind === kind && !made.has(entity.key)).map(entity => entity.name)
  return { stage, state: status.state === 'stale' ? `stale: ${status.why ?? ''}` : status.state, missing, notes: (record.extracted.notes ?? []).slice(0, 40) }
}

/** One staged document in full, or the list of what a stage staged. */
export async function showStaged(world: string, stage: Stage, name?: string): Promise<object> {
  await need(world, ['surveyed', 'built'], 'showing a stage')
  const record = await readStage(world, stage)
  if (record === undefined) throw new ImportStateError(`the stage "${stage}" has not run yet`)
  const extracted = record.extracted
  const all: { group: string; document: Record<string, unknown> }[] = [
    ...(extracted.locations ?? []).map(document => ({ group: 'place', document })), ...(extracted.characters ?? []).map(document => ({ group: 'character', document })),
    ...(extracted.factions ?? []).map(document => ({ group: 'faction', document })), ...(extracted.items ?? []).map(document => ({ group: 'thing', document })),
    ...(extracted.lore ?? []).map(document => ({ group: 'lore', document })), ...(extracted.variables ?? []).map(document => ({ group: 'variable', document })),
    ...(extracted.commands ?? []).map(document => ({ group: 'command', document })), ...(extracted.triggers ?? []).map(document => ({ group: 'trigger', document })),
    ...(extracted.prompts ?? []).map(prompt => ({ group: 'prompt', document: { id: prompt.id, text: prompt.text } as Record<string, unknown> })),
    ...(extracted.rules ?? []).map((rule, index) => ({ group: 'rule', document: { id: `rule-${index + 1}`, text: rule } as Record<string, unknown> })),
  ]
  const label = (document: Record<string, unknown>): string => String(document['name'] ?? document['id'] ?? document['key'] ?? '')
  if (name === undefined) return { stage, documents: all.map(entry => ({ kind: entry.group, name: label(entry.document), characters: JSON.stringify(entry.document).length })) }
  const wanted = name.normalize('NFKC').toLowerCase().trim()
  const found = all.find(entry => [label(entry.document), String(entry.document['id'] ?? '')].some(candidate => candidate.normalize('NFKC').toLowerCase().trim() === wanted))
  if (found === undefined) throw new ImportStateError(`the stage "${stage}" staged nothing called "${name}": list what it staged by leaving the name out`)
  return { stage, kind: found.group, document: found.document }
}

/** Second step, all stages at once: write every character, place, faction, thing and background entry from the pieces that are about it. */
export async function build(ctx: ImportContext, world: string): Promise<BuildSummary> {
  await need(world, ['surveyed', 'built'], 'the build')
  for (const stage of STAGES) {
    ctx.say(`stage: ${stage}`)
    await runStage(ctx, world, stage)
  }
  const extracted = { ...emptyExtracted(), ...await readJson<Partial<Extracted>>(join(folder(world), EXTRACTED)) }
  return { characters: extracted.characters.length, places: extracted.locations.length, factions: extracted.factions.length, things: extracted.items.length, lore: extracted.lore.length, prompts: extracted.prompts.map(entry => entry.id), variables: extracted.variables.length, notes: extracted.notes }
}

/** Last step: write the staged world and check it as a whole; a world that cannot start yet is kept as a repairable draft. */
export async function finish(ctx: ImportContext, world: string): Promise<{ ok: true; report: ImportReport; draft?: WorldCheck; checks: object } | { ok: false; problems: string[] }> {
  await need(world, ['built'], 'the finish')
  const { card, choices, items, picture } = await load(world)
  const classified = await readJson<Classified>(join(folder(world), CLASSIFICATION))
  const roster = await readJson<Roster>(join(folder(world), ROSTER))
  const extracted = { ...emptyExtracted(), ...await readJson<Partial<Extracted>>(join(folder(world), EXTRACTED)).catch(() => ({})) }
  const pictures = await ensurePictures(world, picturesToFetch(card, choices), pieceFinder(card, choices))
  const result = await finishImport(ctx, {
    directory: world, card, choices, roster, items, classified, extracted,
    ...(picture ? { picture: await readFile(join(folder(world), PICTURE_FILE)) } : {}), notes: [], pictures: { found: pictures.found, added: pictures.added.length },
  })
  if (result.ok) {
    await writeJson(join(folder(world), STATE), { phase: result.draft === undefined ? 'done' : 'repair', reviewing: true })
    await recordProvenance(world, { kind: 'import', card: { name: card.name }, language: ctx.language ?? '', counts: result.report.counts, notes: result.report.notes.length }, await readFile(join(folder(world), 'card.json'), 'utf8'))
    return { ...result, checks: await checkImported(world, choices.name, ctx) }
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

/**
 * Imports the card waiting in a world without a model: what {@link structureOnly} lays out is written as the world, with no review after it. A world that would not start yet is left a draft, which the person
 * can keep, discard or have an assistant repair.
 */
export async function structureImport(world: string, language?: string): Promise<{ report: ImportReport; draft?: WorldCheck }> {
  await need(world, ['ready'], 'the import without a model')
  const { card, choices, items, picture } = await load(world)
  const { classified, roster, extracted } = structureOnly(card, items, choices)
  const pictures = await ensurePictures(world, picturesToFetch(card, choices), pieceFinder(card, choices))
  const ctx: ImportContext = { noModel: true, run: () => Promise.reject(new Error('this import has no model')), concurrency: 1, text: (id, variables) => shippedText(id, language ?? 'en', variables), say: () => undefined, ...(language === undefined ? {} : { language }) }
  const result = await finishImport(ctx, {
    directory: world, card, choices, roster, items, classified, extracted,
    ...(picture ? { picture: await readFile(join(folder(world), PICTURE_FILE)) } : {}), notes: [], pictures: { found: pictures.found, added: pictures.added.length },
  })
  if (!result.ok) throw new ImportStateError(`the card could not be written as a world: ${result.problems.join('; ')}`)
  if (result.draft === undefined) await finishedImport(world)
  else await writeJson(join(folder(world), STATE), { phase: 'repair' })
  await recordProvenance(world, { kind: 'import', card: { name: card.name }, language: language ?? '', counts: result.report.counts, notes: result.report.notes.length }, await readFile(join(folder(world), 'card.json'), 'utf8'))
  await checkImported(world, choices.name)
  return { report: result.report, ...(result.draft === undefined ? {} : { draft: result.draft }) }
}
