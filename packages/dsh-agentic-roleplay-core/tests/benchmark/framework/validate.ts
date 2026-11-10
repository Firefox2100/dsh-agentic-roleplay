import type { Files, Language } from '../language.ts'
import { parseSettings } from '../../../src/shared/settings.ts'
import { compose, ComposeError } from './compose.ts'
import { castOf, featuresOf } from './features.ts'
import { layersOf } from './load.ts'
import { sheetsOf } from '../voice.ts'
import { chatLanguage, EXPECTATION_TYPES, FEATURES, type BenchData, type Layer, type Row, type Script } from './types.ts'

/** The layers a row names, in order, or the problems with naming them. */
export function resolveLayers(data: BenchData, row: Row): { layers: Layer[]; problems: string[] } {
  const known = layersOf(data, row.world, row.language)
  const problems: string[] = []
  const layers = row.layers.flatMap((id): Layer[] => {
    const layer = known[id]
    if (layer === undefined) { problems.push(`${row.id}: unknown layer "${id}" for ${row.world} in ${row.language}`); return [] }
    return [layer]
  })
  return { layers, problems }
}

/** The files of a row's world: the bare world with its layers. */
export function worldOfRow(data: BenchData, row: Row): { files: ReturnType<typeof compose>; problems: string[] } {
  const base = data.worlds[row.world]?.files[row.language]
  if (base === undefined) return { files: new Map(), problems: [`${row.id}: ${row.world} has no ${row.language} world`] }
  const { layers, problems } = resolveLayers(data, row)
  try { return { files: compose(base, layers), problems } } catch (error) {
    if (!(error instanceof ComposeError)) throw error
    return { files: new Map(), problems: [...problems, `${row.id}: ${error.message}`] }
  }
}

const KNOWN = new Set<string>(EXPECTATION_TYPES)
/** What can be judged on one turn's narration; the rest is about the story as a whole and belongs at the end of the script. */
const PER_TURN = new Set<string>(['narration-clean', 'narration-language', 'narration-has', 'narration-lacks', 'speaks', 'character-silent', 'player-silent'])

/** What is wrong with a script for the row that plays it: its language, a turn with nothing to say, an unknown expectation, a character the row does not have. */
function scriptProblems(script: Script, row: Row, cast: readonly string[], files: Files): string[] {
  const problems: string[] = []
  const at = `script ${script.id} (row ${row.id})`
  if (script.language !== chatLanguage(row)) problems.push(`${at}: is written in ${script.language}, the row plays in ${chatLanguage(row)}`)
  if (script.turns.length === 0) problems.push(`${at}: has no turns`)
  const all = [...script.turns.flatMap((turn, index) => turn.expect.map(expectation => ({ expectation, where: `turn ${index + 1}` }))), ...script.expect.map(expectation => ({ expectation, where: 'the end' }))]
  script.turns.forEach((turn, index) => {
    const here = `${at}: turn ${index + 1}`
    if ((turn.say === undefined) === (turn.action === undefined)) problems.push(`${here} must either say something or take an action`)
    else if (turn.say !== undefined && turn.say.trim() === '') problems.push(`${here} says nothing`)
    if (turn.action === 'rewind' && (!Number.isInteger(turn.to) || (turn.to ?? -1) < 0 || (turn.to ?? 0) >= index)) problems.push(`${here} rewinds to a turn that is not before it`)
    if (turn.action === 'wait' && (!Number.isInteger(turn.minutes) || (turn.minutes ?? 0) < 1 || (turn.minutes ?? 0) > 240)) problems.push(`${here} waits for a whole number of minutes from 1 to 240`)
    if ((turn.action === 'wait' || turn.action === 'rewind') && turn.expect.length > 0) problems.push(`${here} delivers nothing to expect`)
    if (turn.action === 'regenerate' && index === 0) problems.push(`${here} regenerates a turn that was never played`)
    for (const expectation of turn.expect) if (KNOWN.has(expectation.type) && !PER_TURN.has(expectation.type)) problems.push(`${here} expects ${expectation.type}, which is about the whole story: put it at the end`)
  })
  const folders = new Set((row.folders ?? []).map(folder => folder.name))
  for (const { expectation, where } of all) {
    if ((expectation.type === 'file-exists' || expectation.type === 'file-lacks' || expectation.type === 'file-has' || expectation.type === 'html-sane') && expectation.in !== 'workspace' && expectation.in !== 'outside' && !folders.has(expectation.in)) problems.push(`${at}: ${where} looks in "${expectation.in}", which is neither the workspace, outside nor a folder of the row`)
  }
  for (const [index, turn] of script.turns.entries()) {
    for (const token of turn.say?.match(/\{[^}]+\}/g) ?? []) {
      const name = /^\{folder:([^}]+)\}$/.exec(token)?.[1]
      if (token !== '{workspace}' && token !== '{outside}' && (name === undefined || !folders.has(name))) problems.push(`${at}: turn ${index + 1} writes ${token}, which is not {workspace}, {outside} or {folder:<a folder of the row>}`)
    }
  }
  for (const { expectation, where } of all) {
    if (!KNOWN.has(expectation.type)) { problems.push(`${at}: ${where} expects "${expectation.type}", which is not in the vocabulary`); continue }
    const character = 'character' in expectation ? expectation.character : undefined
    if (character !== undefined && !cast.includes(character)) problems.push(`${at}: ${where} names ${character}, who is not in the row`)
    if (expectation.type === 'speaks-in-voice' && !sheetsOf(files).has(expectation.character)) problems.push(`${at}: ${where} names ${expectation.character}, whose sheet has no speech style to judge by`)
    if (expectation.type === 'speaks-in-voice' && expectation.share !== undefined && !(expectation.share > 0 && expectation.share <= 1)) problems.push(`${at}: ${where} wants a share outside (0, 1]`)
    if (expectation.type === 'item-held-by' && !cast.includes(expectation.holder)) problems.push(`${at}: ${where} names ${expectation.holder}, who is not in the row`)
    if (expectation.type === 'item-held-by' && !has(files, `items/${expectation.item}/item.json`)) problems.push(`${at}: ${where} names the thing ${expectation.item}, which the world does not have`)
    if (expectation.type === 'character-at' && !has(files, `locations/${expectation.place}/location.json`)) problems.push(`${at}: ${where} names the place ${expectation.place}, which the world does not have`)
    if (expectation.type === 'trigger-fired' && !(Array.isArray(files.get('triggers.json')) && (files.get('triggers.json') as { key?: string }[]).some(trigger => trigger.key === expectation.key))) problems.push(`${at}: ${where} names the trigger ${expectation.key}, which the world does not have`)
    if ('text' in expectation && expectation.text.trim() === '') problems.push(`${at}: ${where} expects an empty text`)
  }
  return problems
}

const has = (files: Files, path: string): boolean => files.has(path)

const sameSet = (a: readonly string[], b: readonly string[]): boolean => a.length === b.length && a.every(entry => b.includes(entry))

/** Everything wrong with the data, as sentences; the data is sound when there are none. Whether a composed world also passes the product's own checks is the spec's to ask. */
export function validateData(data: BenchData): string[] {
  const problems: string[] = []
  for (const [id, world] of Object.entries(data.worlds)) {
    if (world.meta.id !== id) problems.push(`world ${id}: bench.json names it ${world.meta.id}`)
    if (world.meta.theme === 'fan' && (world.meta.source === undefined || !/public domain|licen[cs]e/i.test(world.meta.source.derivedFrom) || world.meta.source.note.trim() === '')) problems.push(`world ${id}: a world derived from existing fiction must say in bench.json what it is derived from and that it is public domain or licensed for this, and what was invented`)
    for (const [language, detail] of Object.entries(world.meta.languages) as [Language, NonNullable<(typeof world.meta.languages)[Language]>][]) {
      if (world.files[language] === undefined) problems.push(`world ${id}: language ${language} has no world folder`)
      if (detail.pairedWith !== undefined && world.meta.languages[detail.pairedWith] === undefined) problems.push(`world ${id}: ${language} is paired with ${detail.pairedWith}, which the world does not have`)
    }
    for (const language of Object.keys(world.files) as Language[]) if (world.meta.languages[language] === undefined) problems.push(`world ${id}: has a ${language} folder that bench.json does not list`)
    for (const language of Object.keys(world.meta.languages) as Language[]) {
      const known = layersOf(data, id, language)
      for (const layer of Object.values(known)) {
        for (const other of [...layer.requires, ...layer.conflicts]) if (known[other] === undefined) problems.push(`layer ${layer.id} (${id}, ${language}): names ${other}, which does not exist`)
      }
    }
  }
  const seen = new Set<string>()
  for (const row of data.rows) {
    if (seen.has(row.id)) problems.push(`row ${row.id}: the id is used twice`)
    seen.add(row.id)
    const world = data.worlds[row.world]
    if (world === undefined) { problems.push(`row ${row.id}: unknown world "${row.world}"`); continue }
    if (world.meta.languages[row.language] === undefined) { problems.push(`row ${row.id}: ${row.world} has no ${row.language} version`); continue }
    const known = layersOf(data, row.world, row.language)
    for (const id of row.layers) {
      const layer = known[id]
      if (layer === undefined) continue
      for (const needed of layer.requires) if (!row.layers.includes(needed)) problems.push(`row ${row.id}: layer ${id} needs ${needed}`)
      for (const clash of layer.conflicts) if (row.layers.includes(clash)) problems.push(`row ${row.id}: layers ${id} and ${clash} cannot be together`)
      if (layer.fits.length > 0 && !layer.fits.includes(world.meta.theme) && !(row.probe ?? []).includes(id)) problems.push(`row ${row.id}: layer ${id} fits ${layer.fits.join(', ')}, not ${world.meta.theme}; list it under probe if that is the point`)
    }
    for (const folder of row.folders ?? []) if (!/^[a-z0-9][a-z0-9-]*$/.test(folder.name) || folder.name === 'workspace' || folder.name === 'outside') problems.push(`row ${row.id}: the folder name "${folder.name}" must be letters, digits and "-", and not workspace or outside`)
    for (const file of row.files ?? []) if (file.in !== 'workspace' && !(row.folders ?? []).some(folder => folder.name === file.in)) problems.push(`row ${row.id}: the file ${file.name} goes in "${file.in}", which is neither the workspace nor a folder of the row`)
    if (new Set((row.folders ?? []).map(folder => folder.name)).size !== (row.folders ?? []).length) problems.push(`row ${row.id}: a folder name is used twice`)
    if (row.settings !== undefined) { const parsed = parseSettings(row.settings); if (!parsed.ok) problems.push(`row ${row.id}: the settings are not acceptable: ${parsed.problems.join('; ')}`) }
    if (row.plant !== undefined) {
      const kinds = new Set((data.scripts.find(entry => entry.id === row.script)?.turns ?? []).flatMap(turn => turn.expect).concat(data.scripts.find(entry => entry.id === row.script)?.expect ?? []).map(expectation => expectation.type))
      if (row.script === undefined) problems.push(`row ${row.id}: plants a fault but has no script to see it in`)
      for (const kind of row.plant.caught) if (!kinds.has(kind as never)) problems.push(`row ${row.id}: the planted fault is to be caught by ${kind}, which its script does not expect`)
    }
    for (const id of row.probe ?? []) if (!row.layers.includes(id)) problems.push(`row ${row.id}: probe names ${id}, which is not among its layers`)
    const script = row.script === undefined ? undefined : data.scripts.find(entry => entry.id === row.script)
    if (row.script !== undefined && script === undefined) problems.push(`row ${row.id}: the script ${row.script} does not exist`)
    const composed = worldOfRow(data, row)
    problems.push(...composed.problems)
    if (composed.problems.length > 0) continue
    for (const [question, option] of Object.entries(row.answers ?? {})) {
      const questions = (composed.files.get('world.json') as { start_questions?: { id: string; options: { id: string }[] }[] } | undefined)?.start_questions ?? []
      const asked = questions.find(entry => entry.id === question)
      if (asked === undefined) problems.push(`row ${row.id}: answers the question "${question}", which the composed world does not ask`)
      else if (!asked.options.some(entry => entry.id === option)) problems.push(`row ${row.id}: answers "${question}" with "${option}", which is not one of its options`)
    }
    const features = featuresOf(composed.files)
    if (!sameSet(features, row.features)) problems.push(`row ${row.id}: claims features [${row.features.join(', ')}] but the world has [${features.join(', ')}]`)
    for (const feature of row.features) if (!FEATURES.includes(feature)) problems.push(`row ${row.id}: unknown feature ${feature}`)
    const cast = castOf(composed.files).characters
    if (!cast.includes(row.cast.player)) problems.push(`row ${row.id}: the player ${row.cast.player} is not among the characters [${cast.join(', ')}]`)
    else if (cast.length - 1 !== row.cast.npcs) problems.push(`row ${row.id}: claims ${row.cast.npcs} other characters but the world has ${cast.length - 1}`)
    if (script !== undefined) problems.push(...scriptProblems(script, row, cast, composed.files))
  }
  for (const exclusion of data.excluded) {
    for (const feature of exclusion.features) if (!FEATURES.includes(feature)) problems.push(`exclusion (${exclusion.where}): unknown feature ${feature}`)
    if (exclusion.reason.trim() === '') problems.push(`exclusion (${exclusion.where}): gives no reason`)
  }
  return problems
}
