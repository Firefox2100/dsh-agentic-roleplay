import { InvalidEditProblems, type WorldState } from '../../shared/world-state.ts'
import { createAuthoredEntity, deleteAuthoredEntity } from '../authoring/documents.ts'
import { slug, uniqueKey } from '../import/run.ts'
import { plotReferenceProblems } from '../plots/load.ts'
import { readWorldEditor, type EditableWorld } from './world-editor.ts'

const MAX_TITLE = 200

/**
 * Adds an empty lore entry to the world's files, named by its title.
 * @throws {InvalidEditProblems} when the title is blank or too long.
 */
export async function addWorldLore(world: EditableWorld, title: string): Promise<{ state: WorldState; key: string }> {
  const name = title.trim()
  if (name === '') throw new InvalidEditProblems(['the entry needs a title'])
  if (name.length > MAX_TITLE) throw new InvalidEditProblems([`the title is longer than ${MAX_TITLE} characters`])
  const taken = new Set((await readWorldEditor(world)).lore?.map(entry => entry.key) ?? [])
  const key = uniqueKey(slug(name, 'lore'), taken)
  await createAuthoredEntity(world, 'lore', key, { title: name, kind: 'other', summary: '', body: '' })
  return { state: await readWorldEditor(world), key }
}

/**
 * Moves a lore entry out of the world's files (into `.trash`), unless something else still names it.
 * @throws {InvalidEditProblems} when other lore or a plot refers to it, or there is no such entry.
 */
export async function removeWorldLore(world: EditableWorld, key: string): Promise<WorldState> {
  const state = await readWorldEditor(world)
  if (!(state.lore ?? []).some(entry => entry.key === key)) throw new InvalidEditProblems([`there is no lore entry "${key}"`])
  const citing = (state.lore ?? []).filter(entry => entry.key !== key && (entry.related.some(related => related.key === key) || entry.subjects.some(subject => subject.kind === 'lore' && subject.key === key))).map(entry => entry.title)
  if (citing.length > 0) throw new InvalidEditProblems([`other lore refers to it: ${citing.join(', ')}. Remove those references first`])
  const remaining = [...state.characters.map(entry => entry.key), ...state.factions.map(entry => entry.key), ...state.places.map(entry => entry.key), ...state.things.map(entry => entry.key), ...(state.lore ?? []).filter(entry => entry.key !== key).map(entry => entry.key)]
  const plots = plotReferenceProblems(state.plots.map(plot => plot.definition), remaining)
  if (plots.length > 0) throw new InvalidEditProblems([`a plot refers to it: ${plots.join('; ')}`])
  await deleteAuthoredEntity(world, 'lore', key)
  return await readWorldEditor(world)
}
