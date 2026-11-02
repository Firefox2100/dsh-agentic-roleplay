import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { BenchCase, Expect } from './cases.ts'
import type { Files, Language } from './language.ts'
import { saltHarbor } from './salt-harbor.ts'

/**
 * Salt Harbor grown to the size of a real world: dozens of background entries, tracked values, things, places and townspeople written for it (invented, once, by the
 * development model, natively in each language) and, planted among them, the same thing written again by another hand, a different thing close to one that is not the
 * same, and an entry that contradicts another. Where the planted pair sits among the many is what the small world cannot test: a real double is rarely among the closest.
 */
interface Filler { title?: string; summary?: string; body?: string; name?: string; description?: string; personality?: string; background?: string; speech?: string }
export interface Planted { index: number; mode: 'same' | 'near' | 'conflict'; item: Filler }
export interface Fixture { lore: Filler[]; variables: Filler[]; things: Filler[]; places: Filler[]; people: Filler[]; planted: Record<'lore' | 'variables' | 'things' | 'places' | 'people', Planted[]> }

const fixtures = new Map<Language, Fixture>()
export const fixture = (language: Language): Fixture => {
  const known = fixtures.get(language)
  if (known !== undefined) return known
  const read = JSON.parse(readFileSync(join(import.meta.dirname, 'fixtures', `large-world.${language}.json`), 'utf8')) as Fixture
  fixtures.set(language, read)
  return read
}

const nn = (index: number): string => String(index).padStart(2, '0')
const PLACES = ['pier', 'market', 'harbor', 'lighthouse'] as const

export type Kind = 'lore' | 'variables' | 'things' | 'places' | 'people'
const id = (kind: Kind, index: number, planted = false): string => `${planted ? 'plant' : 'big'}-${{ lore: 'l', variables: 'v', things: 't', places: 'p', people: 'c' }[kind]}${nn(index)}`

function addEntity(files: Files, kind: Kind, index: number, entry: Filler, planted: boolean, language: Language): void {
  const key = id(kind, index, planted)
  const text = entry.description ?? entry.summary ?? ''
  if (kind === 'lore') files.set(`lore/${key}/lore.json`, { id: key, kind: 'history', scope: 'everyone', title: entry.title, summary: entry.summary, body: entry.body, subjects: [] })
  else if (kind === 'things') files.set(`items/${key}/item.json`, { id: key, name: entry.name, description: text, location: PLACES[index % 2] })
  else if (kind === 'places') files.set(`locations/${key}/location.json`, { id: key, name: entry.name, description: text, parent: 'harbor', exits: [{ to: 'market', description: language === 'en' ? 'a lane' : '一条小巷' }] })
  else if (kind === 'people') files.set(`characters/${key}/character.json`, { id: key, name: entry.name, role: 'npc', kind: 'person', tier: 'supporting', summary: entry.summary, personality: entry.personality, background: entry.background, speech: { style: entry.speech ?? '', examples: [] }, start: { public_state: text, activity: entry.summary, location: PLACES[index % 3] } })
  else {
    const list = structuredClone(files.get('variables.json')) as Record<string, unknown>[]
    list.push({ key: key.replaceAll('-', '_'), name: entry.name, description: text, kind: 'number', subject: 'character', min: 0, max: 10, integer: true, default: 0, visibility: 'public' })
    files.set('variables.json', list)
  }
}

/** The grown world: every filler entry, and the planted ones of the kinds asked for. */
function grown(language: Language, kinds: readonly Kind[], plant: boolean): Files {
  const files = saltHarbor(language)
  const data = fixture(language)
  for (const kind of kinds) {
    data[kind].forEach((entry, index) => addEntity(files, kind, index, entry, false, language))
    if (plant) for (const planted of data.planted[kind]) addEntity(files, kind, planted.index, planted.item, true, language)
  }
  return files
}

const SAME_VALUE = ['duplicate-values-meaning'] as const
const SAME_THING = ['name-near'] as const
const CONFLICT = ['lore-conflict'] as const

/** Which entry of each kind has a second hand's version planted next to it, the same in both languages (the generator wrote them at these places). */
export const PLANTED: Record<Kind, Partial<Record<Planted['mode'], readonly number[]>>> = {
  lore: { same: [3, 14, 25, 41], conflict: [7, 19, 36], near: [5, 22, 31] },
  variables: { same: [2, 11, 20], near: [6, 15, 23] },
  things: { same: [4, 13, 26], near: [8, 21] },
  places: { same: [3, 12, 19], near: [7, 16] },
  people: { same: [2, 9], near: [5, 12] },
}

/** The finding for each planted pair of a kind, named by the planted copy: a filler entry that happens to repeat the original must not be credited as the planted one. */
function expecting(kind: Kind, check: string, code: string, mode: Planted['mode']): Expect[] {
  return (PLANTED[kind][mode] ?? []).map((index) => {
    const key = id(kind, index, true)
    return { check, code, text: kind === 'variables' ? key.replaceAll('-', '_') : key }
  })
}

function large(spec: { id: string; title: string; kind: BenchCase['kind']; checks: readonly string[]; world: readonly Kind[]; plant: boolean; of: Kind; check?: string; code?: string; mode?: Planted['mode'] }): BenchCase {
  return {
    id: spec.id, title: spec.title, kind: spec.kind, checks: spec.checks, judged: true,
    expect: spec.check === undefined || spec.code === undefined || spec.mode === undefined ? [] : expecting(spec.of, spec.check, spec.code, spec.mode),
    build: language => grown(language, spec.world, spec.plant),
  }
}

export const LARGE_CASES: readonly BenchCase[] = [
  large({ id: 'large-values', title: 'thirty-odd tracked values, three of them written twice and three close to another without being the same', kind: 'defect', checks: SAME_VALUE, world: ['variables'], plant: true, of: 'variables', check: 'duplicate-values-meaning', code: 'duplicate-value', mode: 'same' }),
  large({ id: 'large-places', title: 'thirty places, three written twice under another name and two close to another without being the same', kind: 'defect', checks: SAME_THING, world: ['places'], plant: true, of: 'places', check: 'name-near', code: 'possible-duplicate', mode: 'same' }),
  large({ id: 'large-things', title: 'thirty-odd things, three written twice and two close to another without being the same', kind: 'defect', checks: SAME_THING, world: ['things'], plant: true, of: 'things', check: 'name-near', code: 'possible-duplicate', mode: 'same' }),
  large({ id: 'large-people', title: 'twenty townspeople, two written twice and two close to another without being the same', kind: 'defect', checks: SAME_THING, world: ['people'], plant: true, of: 'people', check: 'name-near', code: 'possible-duplicate', mode: 'same' }),
  large({ id: 'large-lore', title: 'fifty background entries, three contradicting another, four that restate another and three that are close without being the same', kind: 'defect', checks: CONFLICT, world: ['lore'], plant: true, of: 'lore', check: 'lore-conflict', code: 'lore-conflict', mode: 'conflict' }),
  large({ id: 'large-clean', title: 'the whole grown world with nothing planted', kind: 'clean', checks: [...SAME_VALUE, ...SAME_THING, ...CONFLICT], world: ['lore', 'variables', 'things', 'places', 'people'], plant: false, of: 'lore' }),
]
