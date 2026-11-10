import type { Files } from '../language.ts'
import { FEATURES, type Feature } from './types.ts'

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)
const nonEmpty = (value: unknown): boolean => (Array.isArray(value) ? value.length > 0 : isObject(value) && Object.keys(value).length > 0)
const has = (files: Files, folder: string, name: string): boolean => [...files.keys()].some(path => path.startsWith(`${folder}/`) && path.endsWith(`/${name}`))

/** The features a world's files actually carry: what a row's claim is checked against. */
export function featuresOf(files: Files): Feature[] {
  const world = isObject(files.get('world.json')) ? files.get('world.json') as Record<string, unknown> : {}
  const found: Record<Feature, boolean> = {
    places: has(files, 'locations', 'location.json'),
    items: has(files, 'items', 'item.json'),
    factions: has(files, 'factions', 'faction.json'),
    lore: has(files, 'lore', 'lore.json'),
    variables: nonEmpty(files.get('variables.json')),
    triggers: nonEmpty(files.get('triggers.json')),
    dice: files.has('dice.json'),
    routines: [...files].some(([path, value]) => /^characters\/[^/]+\/character\.json$/.test(path) && isObject(value) && nonEmpty(value['routine'])),
    calendar: files.has('calendar.json'),
    plots: nonEmpty(files.get('plots.json')),
    rules: nonEmpty(world['rules']),
    'start-questions': nonEmpty(world['start_questions']),
    tools: nonEmpty(world['tools']),
    packs: [...files.keys()].some(path => path.startsWith('ui/')),
    prompts: [...files.keys()].some(path => path.startsWith('prompts/')),
  }
  return FEATURES.filter(feature => found[feature])
}

export interface CastFound {
  characters: string[]
}

/** The characters of a world, by id. */
export function castOf(files: Files): CastFound {
  return { characters: [...files.keys()].flatMap(path => /^characters\/([^/]+)\/character\.json$/.exec(path)?.[1] ?? []).sort() }
}

/** How big a cast is for the benchmark: the NPCs the story can ask, besides the player. */
export const CAST_TIERS = [{ id: 'solo', max: 1 }, { id: 'small', max: 3 }, { id: 'ensemble', max: Infinity }] as const
export const tierOf = (npcs: number): (typeof CAST_TIERS)[number]['id'] => CAST_TIERS.find(tier => npcs <= tier.max)!.id
