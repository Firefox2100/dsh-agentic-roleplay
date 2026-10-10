import { CHARACTER_KINDS, CHARACTER_TIERS, LORE_KINDS, type LoreKind } from 'dsh-roleplay-model'
import { formatIssue } from '../validation.ts'
import { parseCharacterFile } from '../characters/character-file.ts'
import { parseFactionFile } from '../factions/faction-file.ts'
import { parseItemFile } from '../items/item-file.ts'
import { parseLocationFile } from '../locations/location-file.ts'
import { parseLoreFile } from '../lore/lore-file.ts'
import type { NormalizedCard } from '../../shared/import-card.ts'
import { MAX_ITEM_CHARS, type SourceItem } from './items.ts'
import { mapLimit, norm, slug, uniqueKey, type ChildJob, type ImportContext, type TextOf } from './run.ts'
import { findEntity, isLeftOut, type Classified, type Entity, type Kind, type Roster } from './survey.ts'

type Document = Record<string, unknown>

/** What the extraction made, ready to be written into the world: one document per file, and what had to be left out of one. */
export interface Extracted {
  characters: Document[]
  locations: Document[]
  factions: Document[]
  items: Document[]
  lore: Document[]
  notes: string[]
}
export const emptyExtracted = (): Extracted => ({ characters: [], locations: [], factions: [], items: [], lore: [], notes: [] })

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

const rosterLines = (roster: Roster): string => (['character', 'place', 'faction', 'thing'] as const)
  .map(kind => `${kind}s: ${roster.filter(entity => entity.kind === kind).map(entity => entity.name).join('; ') || '(none)'}`).join('\n')

function promptFor(entity: Entity, sources: readonly SourceItem[], roster: Roster, card: NormalizedCard): string {
  const pieces = sources.map(source => `[${source.label}]${source.title === '' ? '' : ` ${source.title}`}\n${source.text}`)
  return [
    `Card: ${card.name}`,
    `Make the ${entity.kind}${entity.player ? ' that the player plays' : ''}: ${entity.name}${entity.aliases.length === 0 ? '' : ` (also called: ${entity.aliases.join(', ')})`}`,
    `The others in this world, which are the only ones you may refer to:\n${rosterLines(roster)}`,
    `Source pieces:\n${pieces.length === 0 ? '(none: write only what the name itself implies, and leave the rest empty)' : pieces.join('\n\n---\n\n')}`,
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
  },
  required: ['tier', 'kind', 'summary', 'personality', 'background', 'appearance', 'speech'],
  additionalProperties: false,
} as const

type Built = { document: Document; notes: string[] }

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
  return { document, notes }
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
  const scenes = items.filter(item => (classified[item.id]?.roles ?? []).includes('scenario'))
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

function jobFor(text: TextOf, entity: Entity, sources: readonly SourceItem[], roster: Roster, card: NormalizedCard): ChildJob<Document> {
  const prompt = promptFor(entity, sources, roster, card)
  const make = { character: characterDocument, place: placeDocument, faction: factionDocument, thing: thingDocument }[entity.kind]
  return {
    persona: text(`import/${entity.kind}`, { rules: text('import/common-rules') }),
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
      const answer = await ctx.run(jobFor(ctx.text, entity, sources, roster, card))
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
  const worldItems = items.filter((item) => { const roles = classified[item.id]?.roles ?? []; return roles.includes('world') && !roles.includes('instruction') })
  const taken = new Set<string>()
  const loreResults = await mapLimit(worldItems, ctx.concurrency, async (item, index) => {
    ctx.say(`writing background ${index + 1}/${worldItems.length}: ${item.label}`)
    try {
      const prompt = `Card: ${card.name}\nPiece: ${item.label}${item.title === '' ? '' : `\nTitle: ${item.title}`}\n\nThe entities of this world, which are the only ones the entries may name as subjects:\n${rosterLines(roster)}\n\nSource piece:\n${item.text.slice(0, MAX_ITEM_CHARS + 500)}`
      const answer = await ctx.run<Document>({ persona: ctx.text('import/lore', { rules: ctx.text('import/common-rules') }), prompt, result: LORE_SCHEMA as never, check: value => loreProblem(value, roster, item.text) })
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
  placeAtScenario(result, items, classified, roster)
  pruneLoreSubjects(result)
  return result
}
