import { CHARACTER_KINDS, CHARACTER_TIERS, LORE_KINDS, type LoreKind, type Translate } from 'dsh-roleplay-model'
import { formatIssue } from '../validation.ts'
import { parseCharacterFile } from '../characters/character-file.ts'
import { parseFactionFile } from '../factions/faction-file.ts'
import { parseItemFile } from '../items/item-file.ts'
import { parseLocationFile } from '../locations/location-file.ts'
import { parseLoreFile } from '../lore/lore-file.ts'
import { parseVariablesFile, variableProblems } from '../variables/load.ts'
import type { NormalizedCard } from '../../shared/import-card.ts'
import { cleanText, MAX_ITEM_CHARS, type SourceItem } from './items.ts'
import { promptProblem } from '../prompts/library.ts'
import { PROSE_PROMPTS } from '../prompts/world-prompts.ts'
import { mapLimit, norm, slug, trOf, uniqueKey, type ChildJob, type ImportContext, type TextOf } from './run.ts'
import { findEntity, isLeftOut, type Classified, type Entity, type Kind, type Roster } from './survey.ts'
import { mainRole, mayHoldGuidance, playsRole, statesWorldFacts } from './roles.ts'

type Document = Record<string, unknown>

/** What the extraction made, ready to be written into the world: one document per file, and what had to be left out of one. */
export interface Extracted {
  characters: Document[]
  locations: Document[]
  factions: Document[]
  items: Document[]
  lore: Document[]
  /** The prose prompts the card's instructions became, by prompt id. */
  prompts: { id: string; text: string }[]
  /** What the card keeps track of, as the documents of `variables.json`. */
  variables: Document[]
  /** The passages that say how people are made up in play, as the card wrote them: the casting job turns them into the world's commands and triggers. */
  casting: string[]
  /** The documents of `commands.json` and `triggers.json`. */
  commands: Document[]
  triggers: Document[]
  notes: string[]
}
export const emptyExtracted = (): Extracted => ({ characters: [], locations: [], factions: [], items: [], lore: [], prompts: [], variables: [], casting: [], commands: [], triggers: [], notes: [] })

const SOURCE_BUDGET_CHARS = 14_000
const MAX_TAGGED = 8
const MAX_MENTIONS = 6
const MIN_MENTION_CHARS = 2

const text = (value: unknown): string => (typeof value === 'string' ? value.trim() : '')
const list = (value: unknown): string[] => (Array.isArray(value) ? value.flatMap(entry => (typeof entry === 'string' && entry.trim() !== '' ? [entry.trim()] : [])) : [])
const objects = (value: unknown): Document[] => (Array.isArray(value) ? value.filter((entry): entry is Document => typeof entry === 'object' && entry !== null && !Array.isArray(entry)) : [])
const put = (document: Document, key: string, value: unknown): void => { if (value !== undefined && value !== '' && !(Array.isArray(value) && value.length === 0)) document[key] = value }

/** The pieces an entity is made from: the ones about it, then others that name it, within a budget of text. */
export function sourcesFor(entity: Entity, items: readonly SourceItem[], classified: Classified): SourceItem[] {
  const names = [entity.name, ...entity.aliases].map(norm).filter(name => name.length >= MIN_MENTION_CHARS)
  const about = (item: SourceItem): boolean => (classified[item.id]?.targets ?? []).some(target => target.kind === entity.kind && names.includes(norm(target.name)))
  const tagged = items.filter(item => about(item) && !isLeftOut(classified[item.id] ?? { roles: [], targets: [] })).slice(0, MAX_TAGGED)
  const taken = new Set(tagged.map(item => item.id))
  const mentions = items.filter(item => !taken.has(item.id) && !isLeftOut(classified[item.id] ?? { roles: ['world'], targets: [] }) && names.some(name => norm(item.text).includes(name))).slice(0, MAX_MENTIONS)
  const chosen: SourceItem[] = []
  let used = 0
  for (const item of [...tagged, ...mentions]) {
    if (used + item.text.length > SOURCE_BUDGET_CHARS && chosen.length > 0) continue
    chosen.push(item)
    used += item.text.length
  }
  return chosen
}

const rosterLines = (roster: Roster, tr: Translate): string => ([['character', tr('characters')], ['place', tr('places')], ['faction', tr('factions')], ['thing', tr('things')]] as const)
  .map(([kind, label]) => `${label}: ${roster.filter(entity => entity.kind === kind).map(entity => entity.name).join('; ') || tr('(none)')}`).join('\n')

function promptFor(entity: Entity, sources: readonly SourceItem[], roster: Roster, card: NormalizedCard, tr: Translate): string {
  const pieces = sources.map(source => `[${source.label}]${source.title === '' ? '' : ` ${source.title}`}\n${source.text}`)
  const made = entity.player ? tr('Make the {kind} that the player plays: {name}', { kind: entity.kind, name: entity.name }) : tr('Make the {kind}: {name}', { kind: entity.kind, name: entity.name })
  return [
    tr('Card: {name}', { name: card.name }),
    `${made}${entity.aliases.length === 0 ? '' : ` ${tr('(also called: {names})', { names: entity.aliases.join(', ') })}`}`,
    `${tr('The others in this world, which are the only ones you may refer to:')}\n${rosterLines(roster, tr)}`,
    `${tr('Source pieces:')}\n${pieces.length === 0 ? tr('(none: write only what the name itself implies, and leave the rest empty)') : pieces.join('\n\n---\n\n')}`,
  ].join('\n\n')
}

const str = (description: string) => ({ type: 'string', description })
const strs = (description: string) => ({ type: 'array', items: { type: 'string' }, description })

const CHARACTER_SCHEMA = {
  type: 'object',
  properties: {
    aliases: strs('Other names they go by.'), age: str('As the pieces say it.'), gender: str(''), pronouns: str(''),
    tier: { type: 'string', enum: [...CHARACTER_TIERS] }, kind: { type: 'string', enum: [...CHARACTER_KINDS] },
    summary: str('One or two sentences.'), personality: str(''), background: str(''), appearance: str(''),
    speech: { type: 'object', properties: { style: str(''), examples: strs('Up to eight lines.') }, required: ['style', 'examples'], additionalProperties: false },
    start: { type: 'object', properties: { public_state: str(''), inner_state: str(''), activity: str(''), location: str('A name from the list of places.'), position: str('') }, additionalProperties: false },
    goals: { type: 'array', items: { type: 'object', properties: { name: str(''), description: str('') }, required: ['name'], additionalProperties: false } },
    relationships: { type: 'array', items: { type: 'object', properties: { with: str('A name from the list of characters.'), label: str(''), summary: str('') }, required: ['with', 'label'], additionalProperties: false } },
    carries: strs('Things they have on them at the start (a weapon, a tool, a document, a keepsake), by the name the text gives them. Not things they only know of.'),
    knows: { type: 'object', properties: { places: strs('Names from the list of places that they know of.'), things: strs('Names from the list of things that they know of.'), ways: { type: 'array', items: { type: 'object', properties: { from: str('A name from the list of places.'), to: str('A name from the list of places.') }, required: ['from', 'to'], additionalProperties: false }, description: 'Ways between two places of the list that they know how to take (the way from one to the other).' } }, additionalProperties: false },
  },
  required: ['tier', 'kind', 'summary', 'personality', 'background', 'appearance', 'speech'],
  additionalProperties: false,
} as const

type Built = { document: Document; notes: string[]; /** The things a character has on them at the start, by name, as the model wrote them. */ carried?: string[] }
/** The most things one character is given from what the text says it carries. */
const MAX_CARRIED = 12

/** The document of a character file from what the call answered; names of places and characters become the keys they have in the roster. */
export function characterDocument(entity: Entity, answer: Document, roster: Roster): Built {
  const notes: string[] = []
  const document: Document = { id: entity.key, name: entity.name }
  put(document, 'aliases', [...new Set([...entity.aliases, ...list(answer['aliases'])])].filter(alias => norm(alias) !== norm(entity.name)))
  for (const field of ['age', 'gender', 'pronouns'] as const) put(document, field, text(answer[field]))
  const playable = entity.player
  const group = answer['kind'] === 'group' && !playable
  document['role'] = playable ? 'playable' : 'npc'
  document['kind'] = group ? 'group' : 'person'
  document['tier'] = playable && answer['tier'] === 'background' ? 'principal' : CHARACTER_TIERS.includes(answer['tier'] as never) ? answer['tier'] : 'supporting'
  for (const field of ['summary', 'personality', 'background', 'appearance'] as const) document[field] = text(answer[field])
  const speech = (typeof answer['speech'] === 'object' && answer['speech'] !== null ? answer['speech'] : {}) as Document
  document['speech'] = { style: text(speech['style']), examples: list(speech['examples']).slice(0, 8) }
  const start: Document = {}
  const given = (typeof answer['start'] === 'object' && answer['start'] !== null ? answer['start'] : {}) as Document
  for (const [from, to] of [['public_state', 'public_state'], ['inner_state', 'inner_state'], ['activity', 'activity']] as const) put(start, to, text(given[from]))
  const place = text(given['location']) === '' ? undefined : findEntity(roster, text(given['location']), 'place')
  if (text(given['location']) !== '' && place === undefined) notes.push(`${entity.name}: the place "${text(given['location'])}" is not one of the world's places, so the character starts nowhere`)
  if (place !== undefined) { start['location'] = place.key; put(start, 'position', text(given['position'])) }
  const goals = objects(answer['goals']).filter(goal => text(goal['name']) !== '').map(goal => ({ type: 'agenda', name: text(goal['name']), ...(text(goal['description']) === '' ? {} : { description: text(goal['description']) }), status: 'active' }))
  put(start, 'intents', goals)
  document['start'] = start
  const seen = new Set<string>([entity.key])
  const relationships: Document[] = []
  for (const relation of objects(answer['relationships'])) {
    const other = findEntity(roster, text(relation['with']), 'character')
    if (other === undefined) { notes.push(`${entity.name}: the relationship with "${text(relation['with'])}" names nobody in the world`); continue }
    if (seen.has(other.key) || text(relation['label']) === '') continue
    seen.add(other.key)
    relationships.push({ to: other.key, label: text(relation['label']), ...(text(relation['summary']) === '' ? {} : { summary: text(relation['summary']) }) })
  }
  put(document, 'relationships', relationships.slice(0, 60))
  const knows = (typeof answer['knows'] === 'object' && answer['knows'] !== null ? answer['knows'] : {}) as Document
  const known = (names: string[], kind: 'place' | 'thing'): string[] => [...new Set(names.flatMap((name) => {
    const found = findEntity(roster, name, kind)
    if (found === undefined) notes.push(`${entity.name}: "${name}" is not one of the world's ${kind === 'place' ? 'places' : 'things'}, so they do not know of it`)
    return found === undefined ? [] : [found.key]
  }))]
  const knowledge: Document = {}
  put(knowledge, 'locations', known(list(knows['places']), 'place'))
  put(knowledge, 'items', known(list(knows['things']), 'thing'))
  const ways = new Set<string>()
  const exits: Document[] = []
  for (const way of objects(knows['ways'])) {
    const from = findEntity(roster, text(way['from']), 'place')
    const to = findEntity(roster, text(way['to']), 'place')
    if (from === undefined || to === undefined || from.key === to.key) { notes.push(`${entity.name}: the way from "${text(way['from'])}" to "${text(way['to'])}" is not between two places of the world, so they do not know of it`); continue }
    if (ways.has(`${from.key}>${to.key}`)) continue
    ways.add(`${from.key}>${to.key}`)
    exits.push({ from: from.key, to: to.key })
  }
  put(knowledge, 'exits', exits)
  put(document, 'knowledge', Object.keys(knowledge).length === 0 ? undefined : knowledge)
  const carried = [...new Set(list(answer['carries']))].slice(0, MAX_CARRIED)
  return { document, notes, ...(carried.length === 0 ? {} : { carried }) }
}

const PLACE_SCHEMA = {
  type: 'object',
  properties: {
    description: str('What the place is like.'), parent: str('A name from the list of places.'),
    features: { type: 'array', items: { type: 'object', properties: { name: str(''), description: str('') }, required: ['name'], additionalProperties: false } },
    exits: { type: 'array', items: { type: 'object', properties: { to: str('A name from the list of places.'), description: str('') }, required: ['to'], additionalProperties: false } },
  },
  required: ['description'],
  additionalProperties: false,
} as const

export function placeDocument(entity: Entity, answer: Document, roster: Roster): Built {
  const notes: string[] = []
  const document: Document = { id: entity.key, name: entity.name }
  put(document, 'description', text(answer['description']))
  const named = text(answer['parent']) === '' ? entity.parent : text(answer['parent'])
  const parent = named === undefined ? undefined : findEntity(roster, named, 'place')
  if (named !== undefined && (parent === undefined || parent.key === entity.key)) notes.push(`${entity.name}: the place it is in, "${named}", is not one of the world's places`)
  if (parent !== undefined && parent.key !== entity.key) document['parent'] = parent.key
  const features = objects(answer['features']).filter(feature => text(feature['name']) !== '').slice(0, 30).map((feature, index) => ({ id: `feature-${index + 1}`, name: text(feature['name']), ...(text(feature['description']) === '' ? {} : { description: text(feature['description']) }) }))
  put(document, 'features', features)
  const exits: Document[] = []
  const to = new Set<string>()
  for (const exit of objects(answer['exits'])) {
    const target = findEntity(roster, text(exit['to']), 'place')
    if (target === undefined || target.key === entity.key) { notes.push(`${entity.name}: the way to "${text(exit['to'])}" leads to no place of the world`); continue }
    if (to.has(target.key)) continue
    to.add(target.key)
    exits.push({ to: target.key, ...(text(exit['description']) === '' ? {} : { description: text(exit['description']) }) })
  }
  put(document, 'exits', exits.slice(0, 30))
  return { document, notes }
}

const FACTION_SCHEMA = {
  type: 'object',
  properties: {
    aliases: strs('Other names for it.'), summary: str(''), description: str(''), values: strs('Principles it claims.'), structure: str(''), public_state: str(''), inner_state: str(''),
    members: { type: 'array', items: { type: 'object', properties: { character: str('A name from the list of characters.'), role: str('') }, required: ['character'], additionalProperties: false } },
  },
  required: ['summary', 'description'],
  additionalProperties: false,
} as const

export function factionDocument(entity: Entity, answer: Document, roster: Roster): Built {
  const notes: string[] = []
  const document: Document = { id: entity.key, name: entity.name }
  put(document, 'aliases', [...new Set([...entity.aliases, ...list(answer['aliases'])])].filter(alias => norm(alias) !== norm(entity.name)))
  for (const field of ['summary', 'description', 'structure'] as const) put(document, field, text(answer[field]))
  put(document, 'values', list(answer['values']))
  const start: Document = {}
  put(start, 'public_state', text(answer['public_state']))
  put(start, 'inner_state', text(answer['inner_state']))
  put(document, 'start', Object.keys(start).length === 0 ? undefined : start)
  const members: Document[] = []
  const seen = new Set<string>()
  for (const member of objects(answer['members'])) {
    const character = findEntity(roster, text(member['character']), 'character')
    if (character === undefined) { notes.push(`${entity.name}: the member "${text(member['character'])}" is nobody in the world`); continue }
    if (seen.has(character.key)) continue
    seen.add(character.key)
    members.push({ character: character.key, ...(text(member['role']) === '' ? {} : { role: text(member['role']) }) })
  }
  put(document, 'members', members)
  return { document, notes }
}

const THING_SCHEMA = {
  type: 'object',
  properties: { description: str(''), quality: str(''), notable: { type: 'boolean' }, location: str('A name from the list of places.'), held_by: str('A name from the list of characters.') },
  required: ['description'],
  additionalProperties: false,
} as const

export function thingDocument(entity: Entity, answer: Document, roster: Roster): Built {
  const notes: string[] = []
  const document: Document = { id: entity.key, name: entity.name, unique: true }
  put(document, 'description', text(answer['description']))
  put(document, 'quality', text(answer['quality']))
  if (answer['notable'] === true) document['notable'] = true
  const holder = text(answer['held_by']) === '' ? undefined : findEntity(roster, text(answer['held_by']), 'character')
  const place = text(answer['location']) === '' ? undefined : findEntity(roster, text(answer['location']), 'place')
  if (holder !== undefined) document['held_by'] = holder.key
  else if (place !== undefined) document['location'] = place.key
  else notes.push(`${entity.name}: it is nowhere in the world and nobody has it, so it is left out`)
  return { document, notes }
}

const GUIDANCE_SCHEMA = {
  type: 'object',
  properties: {
    casting: strs('Each passage that says how to make people, places or things up while the story is played, copied exactly.'),
    rules: strs('Each passage that is a standing rule or mechanic the game master applies as the story is played, copied exactly.'),
  },
  required: ['casting', 'rules'],
  additionalProperties: false,
} as const
/** Pieces shorter than this hold no guidance worth a request of its own. */
const MIN_GUIDANCE_CHARS = 120
/** The most characters of standing rules the game master carries on every turn; the rest of what the card always sends is found by search like any lore. */
const STANDING_MAX_CHARS = 12_000
export const STANDING_PROMPT = 'roleplay/standing'

const squeezed = (text: string): string => text.replace(/\s+/g, ' ').trim()

/** Why the passages cannot be used, or nothing when each is in the piece word for word: the guidance is the card's, and a rewrite would be the model's. */
export function passageProblem(answer: Document, source: string): string | undefined {
  const whole = squeezed(source)
  for (const field of ['casting', 'rules'] as const) {
    const passages = Array.isArray(answer[field]) ? answer[field] as unknown[] : []
    const missing = passages.findIndex(passage => typeof passage !== 'string' || squeezed(passage) === '' || !whole.includes(squeezed(passage)))
    if (missing >= 0) return `${field} passage ${missing + 1} is not in the piece word for word: copy it exactly as written, or leave it out`
  }
  return undefined
}

/** The lore entry for the guidance found in a piece, in the card's own words, for the game master and the world author only. */
export function guidanceEntry(passages: readonly string[], title: string): Document {
  const body = passages.map(passage => passage.trim()).join('\n\n')
  return { title: title.slice(0, 100), kind: 'custom', scope: 'listed', summary: (/^[^\n。.!?！？]*[。.!?！？]?/u.exec(body)?.[0] ?? body).slice(0, 200), body }
}

/** What a prompt file cannot hold is changed so that `${` and `{{` in a card's text are not read as variables. */
export const inert = (text: string): string => text.replace(/\$\{/g, '$ {').replace(/\{\{/g, '{ {')

const LORE_SCHEMA = {
  type: 'object',
  properties: {
    entries: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          title: str('A short title.'), kind: { type: 'string', enum: [...LORE_KINDS] }, summary: str('One sentence.'), body: str('The facts, as prose.'),
          subjects: { type: 'array', items: { type: 'object', properties: { kind: { type: 'string', enum: ['character', 'place', 'faction', 'thing'] }, name: str('A name from the lists.') }, required: ['kind', 'name'], additionalProperties: false } },
        },
        required: ['title', 'kind', 'summary', 'body'],
        additionalProperties: false,
      },
    },
  },
  required: ['entries'],
  additionalProperties: false,
} as const

const LORE_SUBJECT: Record<Kind, string> = { character: 'character', place: 'location', faction: 'faction', thing: 'item' }

export function loreDocuments(answer: Document, roster: Roster, taken: Set<string>): Built[] {
  return objects(answer['entries']).flatMap((entry): Built[] => {
    const title = text(entry['title'])
    const body = text(entry['body'])
    if (title === '' || body === '') return []
    const notes: string[] = []
    const subjects: Document[] = []
    const seen = new Set<string>()
    for (const subject of objects(entry['subjects'])) {
      const kind = ['character', 'place', 'faction', 'thing'].includes(text(subject['kind'])) ? text(subject['kind']) as Kind : undefined
      const found = kind === undefined ? undefined : findEntity(roster, text(subject['name']), kind)
      if (found === undefined) { notes.push(`${title}: the subject "${text(subject['name'])}" is not in the world`); continue }
      if (!seen.has(found.key)) { seen.add(found.key); subjects.push({ kind: LORE_SUBJECT[found.kind], id: found.key }) }
    }
    const kind: LoreKind = LORE_KINDS.includes(entry['kind'] as never) ? entry['kind'] as LoreKind : 'other'
    const document: Document = { id: uniqueKey(slug(title, 'lore'), taken), title, kind, summary: text(entry['summary']), body }
    put(document, 'subjects', subjects)
    return [{ document, notes }]
  })
}

/** A background piece as one entry, in the card's own words: what is kept when the model cannot rewrite it without losing its facts. */
export function asWritten(item: { label: string; title: string; text: string }): Document {
  const body = item.text.trim()
  return { entries: [{ title: (item.title === '' ? item.label : item.title).slice(0, 100), kind: 'other', summary: (/^[^\n。.!?！？]*[。.!?！？]?/u.exec(body)?.[0] ?? body).slice(0, 200), body }] }
}

/** At most this many entries come of one piece: a piece that is split into many small entries loses what connects its facts. */
export const MAX_LORE_ENTRIES = 4
/** The entries of a piece must hold at least this share of its text, from a piece of at least `MIN_CHECKED_CHARS` characters: the facts are kept, not summarised away. */
const MIN_LORE_SHARE = 0.5
const MIN_CHECKED_CHARS = 300

/** Why the entries made of a piece cannot be used, or nothing when they can. */
export function loreProblem(answer: Document, roster: Roster, source: string): string | undefined {
  const entries = loreDocuments(answer, roster, new Set())
  if (entries.length === 0) return 'write at least one entry with a title and a body'
  if (entries.length > MAX_LORE_ENTRIES) return `${entries.length} entries is too many for one piece: write at most ${MAX_LORE_ENTRIES}, each with all the facts of its subject`
  const kept = entries.reduce((total, entry) => total + String(entry.document['body']).length, 0)
  const wanted = Math.round(source.length * MIN_LORE_SHARE)
  if (source.length >= MIN_CHECKED_CHARS && kept < wanted) return `the entries hold ${kept} characters of the ${source.length} of the piece: facts were left out. Keep every name, date, number, cause and rule; the bodies together need at least ${wanted} characters`
  return undefined
}

/**
 * Characters the pieces that set the scene name, and that were given no starting place, start in the place those pieces are set in, when
 * there is exactly one: the story begins there, so whoever it opens with is there.
 */
export function placeAtScenario(result: Pick<Extracted, 'characters'>, items: readonly SourceItem[], classified: Classified, roster: Roster): void {
  const scenes = items.filter(item => playsRole(classified[item.id] ?? { roles: [] }, 'scenario'))
  const places = new Set(scenes.flatMap(item => (classified[item.id]?.targets ?? []).filter(target => target.kind === 'place').flatMap((target) => { const found = findEntity(roster, target.name, 'place'); return found === undefined ? [] : [found.key] })))
  if (places.size !== 1) return
  const place = [...places][0]!
  const present = new Set(scenes.flatMap(item => (classified[item.id]?.targets ?? []).filter(target => target.kind === 'character').flatMap((target) => { const found = findEntity(roster, target.name, 'character'); return found === undefined ? [] : [found.key] })))
  for (const character of result.characters) {
    if (!present.has(String(character['id']))) continue
    const start = (character['start'] ?? {}) as Document
    if (start['location'] !== undefined) continue
    character['start'] = { ...start, location: place }
  }
}

/** Takes out of the lore the subjects that were not written (a thing that is nowhere and nobody's is not made), so that no entry names what the world does not have. */
export function pruneLoreSubjects(result: Pick<Extracted, 'characters' | 'locations' | 'factions' | 'items' | 'lore' | 'notes'>): void {
  const written = new Set([
    ...result.characters.map(entry => `character:${String(entry['id'])}`), ...result.locations.map(entry => `location:${String(entry['id'])}`),
    ...result.factions.map(entry => `faction:${String(entry['id'])}`), ...result.items.map(entry => `item:${String(entry['id'])}`),
  ])
  for (const entry of result.lore) {
    const subjects = (entry['subjects'] as Document[] | undefined) ?? []
    const kept = subjects.filter(subject => written.has(`${String(subject['kind'])}:${String(subject['id'])}`))
    if (kept.length === subjects.length) continue
    result.notes.push(`${String(entry['title'])}: ${subjects.length - kept.length} subject(s) left out because the world has no such ${subjects.length - kept.length === 1 ? 'entity' : 'entities'}`)
    if (kept.length === 0) delete entry['subjects']
    else entry['subjects'] = kept
  }
}

/** Takes out of a faction the members whose character was not written (the job for it failed or it was left out): a faction that names no one is better than a world that cannot be written. */
export function pruneMembers(result: Pick<Extracted, 'characters' | 'factions' | 'notes'>): void {
  const written = new Set(result.characters.map(entry => String(entry['id'])))
  for (const faction of result.factions) {
    const members = objects(faction['members'])
    const kept = members.filter(member => written.has(String(member['character'])))
    if (kept.length === members.length) continue
    result.notes.push(`${String(faction['name'])}: ${members.length - kept.length} member(s) left out because the world has no such character`)
    if (kept.length === 0) delete faction['members']
    else faction['members'] = kept
  }
}

/** Takes out of a place the parent and the ways that lead to a place that was not written, and out of a character a starting place that was not: each is only a link, and the document stays. */
export function pruneLinks(result: Pick<Extracted, 'characters' | 'locations' | 'notes'>): void {
  const places = new Set(result.locations.map(entry => String(entry['id'])))
  for (const place of result.locations) {
    if (place['parent'] !== undefined && !places.has(String(place['parent']))) {
      result.notes.push(`${String(place['name'])}: its parent place is left out because the world has no such place`)
      delete place['parent']
    }
    const exits = objects(place['exits'])
    const open = exits.filter(exit => places.has(String(exit['to'])))
    if (open.length === exits.length) continue
    result.notes.push(`${String(place['name'])}: ${exits.length - open.length} way(s) left out because they lead to a place the world does not have`)
    if (open.length === 0) delete place['exits']
    else place['exits'] = open
  }
  for (const character of result.characters) {
    const start = character['start'] as Document | undefined
    if (start === undefined || start['location'] === undefined || places.has(String(start['location']))) continue
    result.notes.push(`${String(character['name'])}: its starting place is left out because the world has no such place`)
    delete start['location']; delete start['position']; delete start['feature']
    if (Object.keys(start).length === 0) delete character['start']
  }
}

/** Takes out of a character's relationships those with a character that was not written. */
export function pruneRelationships(result: Pick<Extracted, 'characters' | 'notes'>): void {
  const written = new Set(result.characters.map(entry => String(entry['id'])))
  for (const character of result.characters) {
    const relations = objects(character['relationships'])
    const kept = relations.filter(relation => written.has(String(relation['to'])))
    if (kept.length === relations.length) continue
    result.notes.push(`${String(character['name'])}: ${relations.length - kept.length} relationship(s) left out because the world has no such character`)
    if (kept.length === 0) delete character['relationships']
    else character['relationships'] = kept
  }
}

/** Takes out of what characters know the places and things that were not written (a thing that is nowhere and nobody's is not made). */
export function pruneKnowledge(result: Pick<Extracted, 'characters' | 'locations' | 'items' | 'notes'>): void {
  const written = { locations: new Set(result.locations.map(entry => String(entry['id']))), items: new Set(result.items.map(entry => String(entry['id']))) }
  const ways = new Set(result.locations.flatMap(place => objects(place['exits']).map(exit => `${String(place['id'])}>${String(exit['to'])}`)))
  for (const character of result.characters) {
    const knowledge = character['knowledge'] as Document | undefined
    if (knowledge === undefined) continue
    const routes = objects(knowledge['exits'])
    const open = routes.filter(route => ways.has(`${String(route['from'])}>${String(route['to'])}`))
    if (open.length !== routes.length) {
      result.notes.push(`${String(character['name'])}: ${routes.length - open.length} known way(s) left out because the world has no such way`)
      if (open.length === 0) delete knowledge['exits']
      else knowledge['exits'] = open
    }
    for (const field of ['locations', 'items'] as const) {
      const keys = (knowledge[field] as string[] | undefined) ?? []
      const kept = keys.filter(key => written[field].has(key))
      if (kept.length === keys.length) continue
      result.notes.push(`${String(character['name'])}: ${keys.length - kept.length} known ${field === 'items' ? 'thing(s)' : 'place(s)'} left out because the world has no such entity`)
      if (kept.length === 0) delete knowledge[field]
      else knowledge[field] = kept
    }
    if (Object.keys(knowledge).length === 0) delete character['knowledge']
  }
}

/**
 * Completes what characters are aware of, because a missing edge means a character does not know the other exists: a character named in someone's relationships
 * knows of that someone (a neutral acquaintance, added when the character has none), and knows the lore that is about them.
 */
export function completeAwareness(result: Pick<Extracted, 'characters' | 'lore' | 'notes'>): void {
  const byId = new Map(result.characters.map(character => [String(character['id']), character]))
  let added = 0
  for (const character of result.characters) {
    for (const relation of (character['relationships'] as Document[] | undefined) ?? []) {
      const other = byId.get(String(relation['to']))
      if (other === undefined || other === character) continue
      const theirs = (other['relationships'] as Document[] | undefined) ?? []
      if (theirs.some(entry => entry['to'] === character['id'])) continue
      other['relationships'] = [...theirs, { to: character['id'], label: 'acquaintance' }]
      added += 1
    }
  }
  if (added > 0) result.notes.push(`${added} relationship(s) were added in the other direction as plain acquaintances, so that both characters know of each other`)
  for (const entry of result.lore) {
    for (const subject of (entry['subjects'] as Document[] | undefined) ?? []) {
      const character = subject['kind'] === 'character' ? byId.get(String(subject['id'])) : undefined
      if (character === undefined) continue
      const knowledge = (character['knowledge'] ?? (character['knowledge'] = {})) as Document
      const known = (knowledge['lore'] as string[] | undefined) ?? []
      if (!known.includes(String(entry['id']))) knowledge['lore'] = [...known, String(entry['id'])]
    }
  }
}

/** Adds an entry unless the world already has it: the same title, or a body that an earlier entry already contains (a longer one replaces a shorter that it contains). */
export function addLore(lore: Document[], entry: Document): void {
  const title = norm(String(entry['title']))
  const body = norm(String(entry['body']))
  const same = lore.findIndex((other) => {
    const otherBody = norm(String(other['body']))
    return norm(String(other['title'])) === title || otherBody.includes(body) || body.includes(otherBody)
  })
  if (same < 0) { lore.push(entry); return }
  if (body.length > norm(String(lore[same]!['body'])).length) lore[same] = { ...entry, id: lore[same]!['id'] as string }
}

/** The file a document will be, read as the world will read it: why it cannot be, if it cannot. */
export function documentProblem(kind: 'character' | 'location' | 'faction' | 'item' | 'lore', document: Document): string | undefined {
  const parse = { character: parseCharacterFile, location: parseLocationFile, faction: parseFactionFile, item: parseItemFile, lore: parseLoreFile }[kind]
  const parsed = parse(JSON.stringify(document), String(document['id']))
  return parsed.ok ? undefined : parsed.issues.map(formatIssue).join('; ')
}

const GROUP_KINDS = { character: 'character', place: 'location', faction: 'faction', thing: 'item' } as const

function jobFor(text: TextOf, tr: Translate, entity: Entity, sources: readonly SourceItem[], roster: Roster, card: NormalizedCard): ChildJob<Document> {
  const prompt = promptFor(entity, sources, roster, card, tr)
  const make = { character: characterDocument, place: placeDocument, faction: factionDocument, thing: thingDocument }[entity.kind]
  return {
    persona: text(`import/${entity.kind}`, { rules: text('import/common-rules') }),
    maxTokens: entity.kind === 'character' ? 6000 : 3000,
    prompt,
    result: { character: CHARACTER_SCHEMA, place: PLACE_SCHEMA, faction: FACTION_SCHEMA, thing: THING_SCHEMA }[entity.kind] as never,
    check: (answer) => {
      const { document } = make(entity, answer, roster)
      if (entity.kind === 'thing' && document['held_by'] === undefined && document['location'] === undefined) return undefined
      return documentProblem(GROUP_KINDS[entity.kind], document)
    },
  }
}

/** Makes the documents of every entity of the roster, and the lore from the pieces about the world. */
export async function extractEntities(ctx: ImportContext, card: NormalizedCard, items: readonly SourceItem[], classified: Classified, roster: Roster): Promise<Extracted> {
  const result = emptyExtracted()
  const entityResults = await mapLimit(roster, ctx.concurrency, async (entity, index): Promise<{ entity: Entity; built?: Built; failure?: string }> => {
    ctx.say(`writing ${entity.kind} ${index + 1}/${roster.length}: ${entity.name}`)
    const sources = sourcesFor(entity, items, classified)
    try {
      const answer = await ctx.run(jobFor(ctx.text, trOf(ctx), entity, sources, roster, card))
      const built = { character: characterDocument, place: placeDocument, faction: factionDocument, thing: thingDocument }[entity.kind](entity, answer, roster)
      return { entity, built }
    } catch (error) {
      return { entity, failure: `${entity.kind} ${entity.name}: ${error instanceof Error ? error.message : String(error)}` }
    }
  })
  for (const { entity, built, failure } of entityResults) {
    if (failure !== undefined || built === undefined) { result.notes.push(failure ?? `${entity.name}: nothing was written`); continue }
    result.notes.push(...built.notes)
    if (entity.kind === 'thing' && built.document['held_by'] === undefined && built.document['location'] === undefined) continue
    const group = { character: 'characters', place: 'locations', faction: 'factions', thing: 'items' } as const
    result[group[entity.kind]].push(built.document)
  }
  // what a character has on it is a thing of its own, held by it, unless the roster has that thing already (its own job says who holds it)
  const itemIds = new Set(result.items.map(entry => String(entry['id'])))
  for (const { entity, built } of entityResults) {
    if (entity.kind !== 'character') continue
    for (const name of built?.carried ?? []) {
      if (findEntity(roster, name, 'thing') !== undefined || result.items.some(entry => norm(String(entry['name'])) === norm(name) && entry['held_by'] === entity.key)) continue
      result.items.push({ id: uniqueKey(slug(name, 'thing'), itemIds), name, held_by: entity.key })
    }
  }
  const worldItems = items.filter(item => statesWorldFacts(classified[item.id] ?? { roles: [] }))
  const taken = new Set<string>()
  const loreResults = await mapLimit(worldItems, ctx.concurrency, async (item, index) => {
    ctx.say(`writing background ${index + 1}/${worldItems.length}: ${item.label}`)
    try {
      const tr = trOf(ctx)
      const prompt = `${tr('Card: {name}', { name: card.name })}\n${tr('Piece: {label}', { label: item.label })}${item.title === '' ? '' : `\n${tr('Title: {title}', { title: item.title })}`}\n\n${tr('The entities of this world, which are the only ones the entries may name as subjects:')}\n${rosterLines(roster, tr)}\n\n${tr('Source piece:')}\n${item.text.slice(0, MAX_ITEM_CHARS + 500)}`
      const answer = await ctx.run<Document>({ persona: ctx.text('import/lore', { rules: ctx.text('import/common-rules') }), maxTokens: 1500 + item.text.length, prompt, result: LORE_SCHEMA as never, check: value => loreProblem(value, roster, item.text) })
      return { item, answer }
    } catch (error) {
      return { item, answer: asWritten(item), failure: `${item.label}: kept as the card wrote it, because the model could not rewrite it (${error instanceof Error ? error.message : String(error)})` }
    }
  })
  for (const { answer, failure } of loreResults) {
    if (failure !== undefined) result.notes.push(failure)
    if (answer === undefined) { result.notes.push('a background piece produced nothing'); continue }
    for (const built of loreDocuments(answer, roster, taken)) { result.notes.push(...built.notes); addLore(result.lore, built.document) }
  }
  for (const item of items.filter(item => playsRole(classified[item.id] ?? { roles: [] }, 'generator'))) {
    for (const built of loreDocuments(asWritten(item), roster, taken)) addLore(result.lore, { ...built.document, kind: 'custom', scope: 'listed' })
  }
  const tr = trOf(ctx)
  const searched = items.filter(item => item.text.length >= MIN_GUIDANCE_CHARS && mayHoldGuidance(classified[item.id] ?? { roles: ['world'] }))
  const found = await mapLimit(searched, ctx.concurrency, async (item, index) => {
    ctx.say(`looking for guidance on making things up and for standing rules ${index + 1}/${searched.length}: ${item.label}`)
    try {
      const prompt = `${tr('Card: {name}', { name: card.name })}\n${tr('Piece: {label}', { label: item.label })}\n\n${tr('Source piece:')}\n${item.text.slice(0, MAX_ITEM_CHARS + 500)}`
      const answer = await ctx.run<Document>({ persona: ctx.text('import/generator', { rules: ctx.text('import/common-rules') }), maxTokens: 600 + item.text.length, prompt, result: GUIDANCE_SCHEMA as never, check: value => passageProblem(value, item.text) })
      const passages = (field: 'casting' | 'rules'): string[] => (answer[field] as string[]).filter(passage => passage.trim() !== '')
      return { item, casting: passages('casting'), rules: passages('rules') }
    } catch (error) {
      return { item, casting: [], rules: [], failure: `${item.label}: ${error instanceof Error ? error.message : String(error)}` }
    }
  })
  let standing = ''
  for (const { item, casting, rules, failure } of found) {
    if (failure !== undefined) result.notes.push(failure)
    const name = item.title === '' ? item.label : item.title
    result.casting.push(...casting)
    if (casting.length > 0) addLore(result.lore, { id: uniqueKey(slug(item.label, 'guidance'), taken), ...guidanceEntry(casting, tr('{label}: how people are made up', { label: name })) })
    if (rules.length === 0) continue
    // what the card always sends is carried on every turn, up to a limit; the rest is lore the game master finds by search
    const block = `## ${name}\n${rules.map(passage => passage.trim()).join('\n\n')}`
    if (item.constant === true && standing.length + block.length <= STANDING_MAX_CHARS) standing += `${standing === '' ? '' : '\n\n'}${block}`
    else addLore(result.lore, { id: uniqueKey(slug(item.label, 'rules'), taken), ...guidanceEntry(rules, tr('{label}: rules and mechanics', { label: name })) })
  }
  if (standing !== '') result.prompts.push({ id: STANDING_PROMPT, text: inert(standing) })
  placeAtScenario(result, items, classified, roster)
  pruneLoreSubjects(result)
  pruneMembers(result)
  pruneLinks(result)
  pruneKnowledge(result)
  completeAwareness(result)
  return result
}

const STYLE_SCHEMA = {
  type: 'object',
  properties: {
    narration: { type: 'string', description: 'How the narration is written: voice, tone, perspective, pacing, level of detail. Empty when the instructions say nothing about it.' },
    characters: { type: 'string', description: 'How every character speaks and behaves: staying in character, manner, and how it deals with what it is asked to do or refuses. Use ${name} for the character. Empty when the instructions say nothing about it.' },
    left_out: { type: 'array', items: { type: 'string' }, description: 'What the instructions contained that is not prose or behaviour guidance (rules of the game, formats, panels, scripts), one short phrase each.' },
    persona_names: { type: 'array', items: { type: 'string' }, description: 'Every name the instructions give to the AI itself (a writer, narrator or assistant persona), exactly as written; empty when it has none. These names must not appear in narration or characters.' },
  },
  required: ['narration', 'characters', 'left_out', 'persona_names'],
} as const

const MAX_STYLE_CHARS = 2000

/** The instructions to the AI that a card carries: its own system and post-history fields, and the pieces judged to be instructions. */
export function instructionPieces(card: NormalizedCard, items: readonly SourceItem[], classified: Classified): string[] {
  const fields = [card.systemPrompt, card.postHistoryInstructions].map(field => cleanText(field, card.name)).filter(field => field !== '')
  const pieces = items.filter(item => mainRole(classified[item.id] ?? { roles: [] }) === 'instruction').map(item => item.text)
  return [...fields, ...pieces]
}

function styleProblem(id: string, value: string, personas: readonly string[] = []): string | undefined {
  const named = personas.find(name => name.trim() !== '' && value.toLowerCase().includes(name.trim().toLowerCase()))
  if (named !== undefined) return `${id} uses the persona name "${named}"; say "the character" or "the narrator" instead`
  if (value.length > MAX_STYLE_CHARS) return `${id} is ${value.length} characters long; keep it to ${MAX_STYLE_CHARS}`
  return value === '' ? undefined : promptProblem('en', id, value)
}

/** Turns the instructions of a card into the prose prompts of the world. Only prose and behaviour are kept: the rules of the game stay the program's. */
export async function extractStyle(ctx: ImportContext, card: NormalizedCard, items: readonly SourceItem[], classified: Classified): Promise<Pick<Extracted, 'prompts' | 'notes'>> {
  return await extractStyleFrom(ctx, card.name, instructionPieces(card, items, classified))
}

/** The prose prompts that instruction texts become, and what was left out of them. */
export async function extractStyleFrom(ctx: ImportContext, name: string, pieces: readonly string[]): Promise<Pick<Extracted, 'prompts' | 'notes'>> {
  if (pieces.length === 0) return { prompts: [], notes: [] }
  ctx.say('writing the style prompts')
  try {
    const tr = trOf(ctx)
    const prompt = `${tr('Card: {name}', { name })}\n\n${tr('The instructions of the card:')}\n\n${pieces.join('\n\n---\n\n').slice(0, SOURCE_BUDGET_CHARS)}`
    const answer = await ctx.run<{ narration: string; characters: string; left_out: string[]; persona_names: string[] }>({
      persona: ctx.text('import/style', { rules: ctx.text('import/common-rules') }),
      maxTokens: 8000,
      prompt,
      result: STYLE_SCHEMA as never,
      check: value => styleProblem('roleplay/style', text(value.narration), list(value.persona_names)) ?? styleProblem('roleplay/character-style', text(value.characters), list(value.persona_names)),
    })
    const made = [['roleplay/style', text(answer.narration)], ['roleplay/character-style', text(answer.characters)]] as const
    const prompts = made.flatMap(([id, body]) => (body === '' ? [] : [{ id, text: body }]))
    if (!prompts.every(entry => PROSE_PROMPTS.includes(entry.id))) throw new Error('only prose prompts can be made')
    return { prompts, notes: list(answer.left_out).map(entry => `instructions not carried: ${entry}`) }
  } catch (error) {
    return { prompts: [], notes: [`the instructions of the card were not carried over: ${error instanceof Error ? error.message : String(error)}`] }
  }
}

const VARIABLES_SCHEMA = {
  type: 'object',
  properties: {
    variables: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          key: { type: 'string', description: 'Lowercase ASCII letters, digits and underscores, starting with a letter: trust_meter.' },
          name: { type: 'string' },
          description: { type: 'string', description: 'What it measures, in a sentence.' },
          kind: { type: 'string', enum: ['number', 'flag', 'choice'] },
          subject: { type: 'string', enum: ['character', 'item', 'location', 'world'] },
          visibility: { type: 'string', enum: ['public', 'private', 'hidden'] },
          only: { type: 'array', items: { type: 'string' }, description: 'Names from the lists of characters, places or things it is limited to; empty for all.' },
          min: { oneOf: [{ type: 'number' }, { type: 'null' }], description: 'The lowest value the card allows, or null.' }, max: { oneOf: [{ type: 'number' }, { type: 'null' }], description: 'The highest value the card allows, or null.' }, integer: { type: 'boolean', description: 'True when it counts whole units.' },
          default: { oneOf: [{ type: 'number' }, { type: 'boolean' }, { type: 'string' }, { type: 'null' }], description: 'Where it starts: a number, true or false, or one of the options; null when the card does not say.' },
          options: { type: 'array', items: { type: 'string' } },
          bands: { type: 'array', items: { type: 'object', properties: { up_to: { type: 'number' }, label: { type: 'string' } }, required: ['up_to', 'label'], additionalProperties: false } },
        },
        // every field is required (empty or null when the card says nothing): models leave optional fields out, and with them the limits and starting values the card gives
        required: ['key', 'name', 'description', 'kind', 'subject', 'visibility', 'only', 'min', 'max', 'integer', 'default', 'options', 'bands'],
        additionalProperties: false,
      },
    },
    left_out: { type: 'array', items: { type: 'string' }, description: 'What the card contained that is not a tracked value, one short phrase each.' },
  },
  required: ['variables', 'left_out'],
} as const

/** The pieces that may describe what a card tracks: its panels and formats, and its instructions. */
/** What a card that keeps its game state in variables says of them: the tool that updates them names itself in the text, whatever role the piece was given. */
const STATE_SPEC = /stat_data|\[mvu_|<UpdateVariable>|<initvar>|JSON ?Patch/i

function trackingPieces(card: NormalizedCard, items: readonly SourceItem[], classified: Classified): string[] {
  const specs = items.filter(item => mainRole(classified[item.id] ?? { roles: [] }) !== 'irrelevant' && STATE_SPEC.test(item.text)).map(item => item.text)
  return [...new Set([...items.filter(item => mainRole(classified[item.id] ?? { roles: [] }) === 'template').map(item => item.text), ...instructionPieces(card, items, classified), ...specs])]
}

/** The documents of `variables.json` an answer describes, with the roster's names turned into keys. */
export function variableDocuments(answer: Document, roster: Roster): Document[] {
  const keyOf = (name: string): string | undefined => roster.find(entity => norm(entity.name) === norm(name) || entity.aliases.some(alias => norm(alias) === norm(name)))?.key
  const taken = new Set<string>()
  return objects(answer['variables']).map((entry, index) => {
    const base = slug(text(entry['key']) || text(entry['name']), '').replace(/-/g, '_').slice(0, 40)
    const document: Document = { key: uniqueKey(/^[a-z][a-z0-9_]*$/.test(base) ? base : `variable_${index + 1}`, taken), name: text(entry['name']), kind: text(entry['kind']), subject: text(entry['subject']) }
    put(document, 'description', text(entry['description']))
    put(document, 'visibility', text(entry['visibility']))
    put(document, 'only', list(entry['only']).flatMap(name => keyOf(name) ?? []))
    for (const field of ['min', 'max'] as const) if (typeof entry[field] === 'number') document[field] = entry[field]
    if (typeof entry['integer'] === 'boolean') document['integer'] = entry['integer']
    if (['number', 'boolean', 'string'].includes(typeof entry['default'])) document['default'] = entry['default']
    put(document, 'options', list(entry['options']))
    put(document, 'bands', objects(entry['bands']).filter(band => typeof band['up_to'] === 'number' && text(band['label']) !== '').map(band => ({ up_to: band['up_to'], label: text(band['label']) })))
    return document
  })
}

/** What is wrong with the declarations, as the world would find it; nothing when they can be used. */
export function variablesProblem(documents: readonly Document[], roster: Roster): string | undefined {
  const parsed = parseVariablesFile(JSON.stringify(documents))
  if (!parsed.ok) return parsed.issues.map(issue => `${issue.path} ${issue.message}`.trim()).join('; ')
  const ids = (kind: string): { id: string }[] => roster.filter(entity => entity.kind === kind).map(entity => ({ id: entity.key }))
  const problems = variableProblems({ defs: parsed.value, characters: ids('character') as never, items: ids('thing') as never, locations: ids('place') as never, values: undefined })
  return problems.length === 0 ? undefined : problems.join('; ')
}

/** The most of the card's tracking text one request reads: a request with all of it made the model write on until its limit without answering. */
const TRACKING_GROUP_CHARS = 6000

/** The pieces cut into groups that each fit one request, in order. */
export function trackingGroups(pieces: readonly string[], max: number = TRACKING_GROUP_CHARS): string[][] {
  const groups: string[][] = []
  let size = 0
  for (const piece of pieces) {
    const text = piece.length > max ? piece.slice(0, max) : piece
    if (groups.length === 0 || size + text.length > max) { groups.push([]); size = 0 }
    groups.at(-1)!.push(text)
    size += text.length
  }
  return groups
}

/** How many tracked values one request is asked to declare when nothing says otherwise, and how many requests one group of the card's text may take: a card that tracks more is asked again for the rest. */
const DEFAULT_VARIABLES_PER_REQUEST = 25
const MAX_VARIABLE_ROUNDS = 12
const TOKENS_PER_VARIABLE = 600

/** Finds what the card keeps track of, such as status panels and meters, and writes it as the world's tracked variables. Each group of the card's tracking text is read on its own, a request declares at most `variablesPerRequest` values and is asked again, told what is declared already, while it fills its share; the first declaration of a key stands. */
export async function extractVariables(ctx: ImportContext, card: NormalizedCard, items: readonly SourceItem[], classified: Classified, roster: Roster): Promise<Pick<Extracted, 'variables' | 'notes'>> {
  const groups = trackingGroups(trackingPieces(card, items, classified))
  if (groups.length === 0) return { variables: [], notes: [] }
  const perRequest = ctx.variablesPerRequest ?? DEFAULT_VARIABLES_PER_REQUEST
  const names = (kind: string): string => roster.filter(entity => entity.kind === kind).map(entity => entity.name).join(', ')
  const tr = trOf(ctx)
  const found = await mapLimit(groups, ctx.concurrency, async (pieces, index) => {
    const documents: Document[] = []
    const notes: string[] = []
    for (let round = 1; round <= MAX_VARIABLE_ROUNDS; round += 1) {
      ctx.say(`looking for what the card tracks ${index + 1}/${groups.length}${round === 1 ? '' : `, round ${round}`}`)
      try {
        const declared = documents.length === 0 ? '' : `\n\n${tr('Already declared (do not declare them again):')} ${documents.map(document => text(document['key'])).join(', ')}`
        const prompt = `${tr('Card: {name}', { name: card.name })}\n\n${tr('Characters:')} ${names('character')}\n${tr('Places:')} ${names('place')}\n${tr('Things:')} ${names('thing')}\n\n${tr('The pieces of the card that may describe what it tracks:')}\n\n${pieces.join('\n\n---\n\n')}${declared}`
        const answer = await ctx.run<Document>({
          persona: ctx.text('import/variables', { rules: ctx.text('import/common-rules'), max: perRequest }),
          // a model asked for a share of the values still tends to write all it finds, about this much each
          maxTokens: Math.max(6000, perRequest * TOKENS_PER_VARIABLE),
          prompt,
          result: VARIABLES_SCHEMA as never,
        })
        // one declaration that cannot be used is left out with its reason; it does not cost the rest of the answer
        const proposed: Document[] = []
        for (const document of variableDocuments(answer, roster)) {
          const problem = variablesProblem([document], roster)
          if (problem === undefined) proposed.push(document)
          else notes.push(`not tracked: ${text(document['name'])}: ${problem}`)
        }
        const fresh = proposed.filter(document => !documents.some(kept => kept['key'] === document['key']))
        documents.push(...fresh)
        if (round === 1) notes.push(...list(answer['left_out']).map(entry => `not tracked: ${entry}`))
        // an answer that did not fill its share has said all there is
        if (proposed.length < perRequest || fresh.length === 0) break
      } catch (error) {
        notes.push(`what part ${index + 1} of the card tracks was not carried over${round === 1 ? '' : ` after round ${round - 1}`}: ${error instanceof Error ? error.message : String(error)}`)
        break
      }
    }
    return { documents, notes }
  })
  const variables: Document[] = []
  for (const document of found.flatMap(entry => entry.documents)) if (!variables.some(kept => kept['key'] === document['key'])) variables.push(document)
  return { variables, notes: found.flatMap(entry => entry.notes) }
}
