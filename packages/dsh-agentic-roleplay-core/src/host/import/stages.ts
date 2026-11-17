import { readFile, readdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { atomicWriteJson } from '../atomic-write.ts'
import type { NormalizedCard } from '../../shared/import-card.ts'
import { extractCasting } from './casting.ts'
import { emptyExtracted, extractBackground, extractCharacters, extractFactions, extractPlaces, extractStyle, extractThings, extractVariables, mergeExtracted, settleExtracted, type Extracted } from './extract.ts'
import type { SourceItem } from './items.ts'
import { trOf, type ChildJob, type ImportContext } from './run.ts'
import { IMPORT_FOLDER } from './store.ts'
import { isLeftOut, type Classified, type Roster } from './survey.ts'

/** The parts of the build, in the order they are best run: what the world is made of (places first, because characters start in them), then how it is told. */
export const STAGES = ['places', 'characters', 'factions', 'things', 'background', 'style', 'variables', 'casting'] as const
export type Stage = typeof STAGES[number]

/** The stages a stage reads the result of. Only the casting passages travel between stages; every other job reads the survey. */
export const STAGE_NEEDS: Readonly<Record<Stage, readonly Stage[]>> = {
  places: [], characters: [], factions: [], things: [], background: [], style: [], variables: [], casting: ['background'],
}

export const isStage = (value: unknown): value is Stage => typeof value === 'string' && (STAGES as readonly string[]).includes(value)

/** What each stage writes, for the person reading a report. */
export const STAGE_ABOUT: Readonly<Record<Stage, string>> = {
  places: 'the places',
  characters: 'the characters (and the places their starts name that the survey lacks, and what they carry)',
  factions: 'the organisations',
  things: 'the things',
  background: 'the background of the world (lore, generator pieces, rules and casting passages)',
  style: 'the narration style and the rules of the world, from the card\'s instructions',
  variables: 'the values the card keeps track of',
  casting: 'the commands and triggers that make people up in play',
}

/** What one run of a stage left: its documents and notes, the survey it read, and what the person asked of it. */
export interface StageRecord {
  stage: Stage
  at: string
  /** The revision of the survey the stage read: a stage whose survey has changed since is stale. */
  revision: number
  /** The exact runs of prerequisite stages this run read. */
  needs?: Partial<Record<Stage, string>>
  guidance?: string
  extracted: Partial<Extracted>
}

export type StageState = 'todo' | 'done' | 'stale'

export interface StageStatus {
  stage: Stage
  state: StageState
  at?: string
  guidance?: string
  counts: Record<string, number>
  /** Notes the run made, of which the first ones are the failures. */
  notes: number
  why?: string
}

const folder = (world: string): string => join(world, IMPORT_FOLDER)
const STAGES_FOLDER = 'stages'
const REVISION = 'survey-revision.json'

async function readJson<T>(file: string): Promise<T | undefined> {
  try { return JSON.parse(await readFile(file, 'utf8')) as T } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw error
  }
}

const stageFile = (world: string, stage: Stage): string => join(folder(world), STAGES_FOLDER, `${stage}.json`)

export const readStage = (world: string, stage: Stage): Promise<StageRecord | undefined> => readJson<StageRecord>(stageFile(world, stage))
export const writeStage = (world: string, record: StageRecord): Promise<void> => atomicWriteJson(stageFile(world, record.stage), record, { createDirectory: true })

/** Forgets what every stage wrote: a new survey starts the build over. */
export async function clearStages(world: string): Promise<void> {
  await rm(join(folder(world), STAGES_FOLDER), { recursive: true, force: true })
}

/** The survey's revision and whether the person (or their assistant) changed it after the model made it. */
export async function readRevision(world: string): Promise<{ revision: number; edited: boolean }> {
  return await readJson<{ revision: number; edited: boolean }>(join(folder(world), REVISION)) ?? { revision: 0, edited: false }
}

/** The survey was changed by hand: the stages that read the one before are stale. */
export async function surveyEdited(world: string): Promise<number> {
  const { revision } = await readRevision(world)
  await atomicWriteJson(join(folder(world), REVISION), { revision: revision + 1, edited: true }, { createDirectory: true })
  return revision + 1
}

/** A survey made by the model starts as it made it. */
export async function surveyMade(world: string): Promise<void> {
  const { revision } = await readRevision(world)
  await atomicWriteJson(join(folder(world), REVISION), { revision: revision + 1, edited: false }, { createDirectory: true })
}

const GROUPS = ['characters', 'locations', 'factions', 'items', 'lore', 'prompts', 'rules', 'variables', 'commands', 'triggers'] as const
const COUNT_NAMES: Record<(typeof GROUPS)[number], string> = { characters: 'characters', locations: 'places', factions: 'factions', items: 'things', lore: 'lore', prompts: 'prompts', rules: 'rules', variables: 'variables', commands: 'commands', triggers: 'triggers' }

/** How many of each kind of document a stage's result holds, leaving out the kinds it has none of. */
export function countsOf(extracted: Partial<Extracted>): Record<string, number> {
  const counts: Record<string, number> = {}
  for (const group of GROUPS) {
    const length = extracted[group]?.length ?? 0
    if (length > 0) counts[COUNT_NAMES[group]] = length
  }
  return counts
}

/** What every stage has done, and which of the stages that ran have to run again. */
export async function statusOf(world: string): Promise<StageStatus[]> {
  const { revision } = await readRevision(world)
  const records = new Map<Stage, StageRecord>()
  for (const stage of STAGES) {
    const record = await readStage(world, stage)
    if (record !== undefined) records.set(stage, record)
  }
  return STAGES.map((stage): StageStatus => {
    const record = records.get(stage)
    if (record === undefined) return { stage, state: 'todo', counts: {}, notes: 0 }
    const changed = STAGE_NEEDS[stage].find(need => record.needs?.[need] !== records.get(need)?.at)
    const why = record.revision === revision ? (changed === undefined ? undefined : `${changed} was run again after it`) : 'the survey was changed after it'
    return { stage, state: why === undefined ? 'done' : 'stale', at: record.at, ...(record.guidance === undefined ? {} : { guidance: record.guidance }), counts: countsOf(record.extracted), notes: record.extracted.notes?.length ?? 0, ...(why === undefined ? {} : { why }) }
  })
}

/** Whether every stage has run on the survey as it is now: the world can be written. */
export const complete = (status: readonly StageStatus[]): boolean => status.every(entry => entry.state === 'done')

/** The documents of every stage that has run, as one extraction, with what no stage can do alone settled. */
export async function mergedStages(world: string, items: readonly SourceItem[], classified: Classified, roster: Roster): Promise<Extracted> {
  const parts: Partial<Extracted>[] = []
  for (const stage of STAGES) {
    const record = await readStage(world, stage)
    if (record !== undefined) parts.push(record.extracted)
  }
  const merged = mergeExtracted(parts)
  // the marker the background leaves for the casting passages' pieces is only for the casting stage, which names the commands and triggers' sources itself
  merged.derived = merged.derived.filter(entry => !(entry.kind === 'command' && entry.name === ''))
  return settleExtracted(merged, items, classified, roster)
}

/** The folders of stage records that exist, for a world whose import was begun before stages. */
export async function hasStages(world: string): Promise<boolean> {
  return await readdir(join(folder(world), STAGES_FOLDER)).then(names => names.length > 0, () => false)
}

/** A context whose jobs carry the person's note for the step: it is part of each job's prompt, so a job asked again with another note is a new job. */
export function withGuidance(ctx: ImportContext, guidance: string | undefined): ImportContext {
  if (guidance === undefined || guidance.trim() === '') return ctx
  const tr = trOf(ctx)
  const note = `${tr('A note from the person importing the card, for this step. Follow it where the card allows; it never overrides the rules above:')}\n${guidance.trim()}`
  return { ...ctx, run: <T>(job: ChildJob<T>) => ctx.run<T>({ ...job, prompt: `${job.prompt}\n\n${note}` }) }
}

/** What a stage reads: the card, its survey, and (for the casting) what the background found. */
export interface StageInput {
  card: NormalizedCard
  items: readonly SourceItem[]
  classified: Classified
  roster: Roster
  /** The background stage's record, for the stages that read it. */
  background?: Partial<Extracted> | undefined
}

/** Makes the documents of one stage. */
export async function produce(stage: Stage, ctx: ImportContext, input: StageInput): Promise<Partial<Extracted>> {
  const { card, items, classified, roster } = input
  const written = items.filter(item => !isLeftOut(classified[item.id]!))
  switch (stage) {
    case 'places': return await extractPlaces(ctx, card, written, classified, roster)
    case 'characters': return await extractCharacters(ctx, card, written, classified, roster)
    case 'factions': return await extractFactions(ctx, card, written, classified, roster)
    case 'things': return await extractThings(ctx, card, written, classified, roster)
    case 'background': return await extractBackground(ctx, card, written, classified, roster)
    case 'style': {
      const style = await extractStyle(ctx, card, items, classified)
      return { ...emptyExtracted(), prompts: style.prompts, rules: style.rules, notes: style.notes, derived: style.derived }
    }
    case 'variables': {
      const tracked = await extractVariables(ctx, card, items, classified, roster)
      return { ...emptyExtracted(), variables: tracked.variables, notes: tracked.notes, derived: tracked.derived }
    }
    case 'casting': {
      const cast = await extractCasting(ctx, card, input.background?.casting ?? [])
      const from = (input.background?.derived ?? []).filter(entry => entry.kind === 'command' && entry.name === '').flatMap(entry => entry.pieces)
      const named = (document: Record<string, unknown>): string => (typeof document['name'] === 'string' && document['name'] !== '' ? document['name'] : typeof document['id'] === 'string' ? document['id'] : typeof document['key'] === 'string' ? document['key'] : 'unnamed')
      return {
        ...emptyExtracted(), commands: cast.commands, triggers: cast.triggers, notes: cast.notes,
        derived: [...cast.commands.map(document => ({ kind: 'command' as const, name: named(document), pieces: from })), ...cast.triggers.map(document => ({ kind: 'trigger' as const, name: named(document), pieces: from }))],
      }
    }
  }
}
