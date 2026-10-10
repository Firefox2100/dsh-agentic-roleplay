import type { NormalizedCard } from '../../shared/import-card.ts'
import type { SourceItem } from './items.ts'
import { mapLimit, norm, slug, uniqueKey, type ChildJob, type ImportContext, type TextOf } from './run.ts'

export const ROLES = ['character', 'player', 'speech', 'place', 'faction', 'thing', 'world', 'scenario', 'instruction', 'template', 'irrelevant'] as const
export type Role = typeof ROLES[number]

/** Whom or what a piece is about, and what kind of thing that is; `other` is an event, an idea or anything that is not one of the four kinds. */
export interface Target {
  name: string
  kind: Kind | 'other'
}

/** What one piece of the card is, and whom or what it is about. */
export interface Classification {
  roles: Role[]
  targets: Target[]
}
export type Classified = Record<string, Classification>

export const KINDS = ['character', 'place', 'faction', 'thing'] as const
export type Kind = typeof KINDS[number]

export interface Entity {
  kind: Kind
  /** The file-safe id the entity gets in the world. */
  key: string
  name: string
  aliases: string[]
  /** Whether the player plays it (characters only). */
  player: boolean
  /** The place this one is in, by its name (places only). */
  parent?: string
}
export type Roster = Entity[]

/** The roles that tell what an entity is. The others are about the world, the story or the card itself. */
const ENTITY_ROLES: Record<Role, Kind | undefined> = { character: 'character', player: 'character', speech: 'character', place: 'place', faction: 'faction', thing: 'thing', world: undefined, scenario: undefined, instruction: undefined, template: undefined, irrelevant: undefined }
/** The roles of pieces that are not carried on: they say how to run a story, or nothing about this one. */
const LEFT_OUT = new Set<Role>(['instruction', 'template', 'irrelevant'])

export const kindOfRole = (role: Role): Kind | undefined => ENTITY_ROLES[role]
export const isLeftOut = (classification: Classification): boolean => classification.roles.every(role => LEFT_OUT.has(role))

const MAX_TARGETS = 10
const MAX_NAME = 100

/** What a name is when it only stands for the person using the card: not a character of the card. */
const PLAYER_WORDS = /^(the |a )?(player|user|you|reader|玩家|用户|你)$/i
const isPlayerWord = (name: string): boolean => PLAYER_WORDS.test(name.trim())
const SHOWN_CHARS = 5000

const CLASSIFY_SCHEMA = {
  type: 'object',
  properties: {
    roles: { type: 'array', items: { type: 'string', enum: [...ROLES] }, description: 'What the piece is, the most important first (one to three).' },
    targets: {
      type: 'array',
      items: { type: 'object', properties: { name: { type: 'string' }, kind: { type: 'string', enum: ['character', 'place', 'faction', 'thing', 'other'] } }, required: ['name', 'kind'], additionalProperties: false },
      description: `What it is mostly about, as the text spells the names (at most ${MAX_TARGETS}).`,
    },
  },
  required: ['roles', 'targets'],
  additionalProperties: false,
} as const

function classifyJob(text: TextOf, card: NormalizedCard, item: SourceItem): ChildJob<Classification> {
  const header = [`Card: ${card.name}`, `Piece: ${item.label}`, ...(item.title === '' ? [] : [`Title: ${item.title}`]), ...(item.keys.length === 0 ? [] : [`Keys: ${item.keys.join(', ')}`])]
  return {
    persona: text('import/classifier', { max: MAX_TARGETS }),
    prompt: `${header.join('\n')}\n---\n${item.text.slice(0, SHOWN_CHARS)}`,
    result: CLASSIFY_SCHEMA as never,
    check: (value) => {
      if (value.roles.length === 0 || value.roles.length > 3 || new Set(value.roles).size !== value.roles.length) return 'give one to three different roles'
      if (value.targets.length > MAX_TARGETS) return `give at most ${MAX_TARGETS} names`
      if (value.targets.some(target => target.name.trim() === '' || target.name.length > MAX_NAME || isPlayerWord(target.name) || /\[PLAYER\]|\{\{\s*user\s*\}\}/i.test(target.name))) return 'every name must be a real name of at most 100 characters, and never [PLAYER]'
      return undefined
    },
  }
}

/** A piece is about the player's own character only when the card says so in terms of the player (its `{{user}}`): a protagonist of the story is not the player. */
export function playerRoleKept(roles: readonly Role[], text: string): Role[] {
  if (!roles.includes('player') || text.includes('[PLAYER]')) return [...roles]
  const rest = roles.filter(role => role !== 'player')
  return rest.length === 0 ? ['character'] : rest
}

/** Says what every piece is. A piece that cannot be classified is kept as world background, so that nothing is lost silently; the failures are returned. */
export async function classifyItems(ctx: ImportContext, card: NormalizedCard, items: readonly SourceItem[]): Promise<{ classified: Classified; failures: string[] }> {
  const failures: string[] = []
  const answers = await mapLimit(items, ctx.concurrency, async (item, index) => {
    ctx.say(`classifying ${index + 1}/${items.length}: ${item.label}`)
    try {
      const value = await ctx.run(classifyJob(ctx.text, card, item))
      const seen = new Set<string>()
      const targets = value.targets.map(target => ({ name: target.name.trim(), kind: target.kind })).filter(target => !isPlayerWord(target.name)).filter((target) => { const id = `${target.kind}:${norm(target.name)}`; if (seen.has(id)) return false; seen.add(id); return true })
      return { roles: playerRoleKept(value.roles, item.text), targets } satisfies Classification
    } catch (error) {
      failures.push(`${item.label}: ${error instanceof Error ? error.message : String(error)}`)
      return { roles: ['world'], targets: [] } satisfies Classification
    }
  })
  return { classified: Object.fromEntries(items.map((item, index) => [item.id, answers[index]!])), failures }
}

export interface Candidate {
  kind: Kind
  name: string
  player: boolean
  pieces: string[]
  titles: string[]
}

/** A name that is only part of one longer name of the same kind (a given name, a short form) is that entity: it is folded into it as an alias. Several longer names make it ambiguous, so it stays. */
export function foldContained(candidates: readonly Candidate[]): { candidate: Candidate; aliases: string[] }[] {
  const merged = candidates.map(candidate => ({ candidate, aliases: [] as string[], gone: false }))
  for (const short of merged) {
    const key = norm(short.candidate.name)
    if (key.length < 2) continue
    const longer = merged.filter(other => other !== short && !other.gone && other.candidate.kind === short.candidate.kind && norm(other.candidate.name).length > key.length && norm(other.candidate.name).includes(key))
    if (longer.length !== 1) continue
    longer[0]!.aliases.push(short.candidate.name, ...short.aliases)
    longer[0]!.candidate.player ||= short.candidate.player
    for (const piece of short.candidate.pieces) if (!longer[0]!.candidate.pieces.includes(piece)) longer[0]!.candidate.pieces.push(piece)
    short.gone = true
  }
  return merged.filter(entry => !entry.gone).map(({ candidate, aliases }) => ({ candidate, aliases }))
}

/** The names the pieces are about, by kind: the same name in different spellings of case or punctuation is one. */
export function candidatesOf(items: readonly SourceItem[], classified: Classified): Candidate[] {
  const found = new Map<string, Candidate>()
  for (const item of items) {
    const classification = classified[item.id]
    if (classification === undefined) continue
    if (isLeftOut(classification)) continue
    for (const { name, kind } of classification.targets) {
      if (kind === 'other' || norm(name) === '') continue
      const id = `${kind}:${norm(name)}`
      const candidate = found.get(id) ?? { kind, name, player: false, pieces: [], titles: [] }
      candidate.player ||= kind === 'character' && classification.roles.includes('player')
      if (!candidate.pieces.includes(item.id)) { candidate.pieces.push(item.id); if (item.title !== '' && candidate.titles.length < 2) candidate.titles.push(item.title) }
      found.set(id, candidate)
    }
  }
  return [...found.values()]
}

const ENTRY = (extra: Record<string, unknown> = {}) => ({
  type: 'object',
  properties: { name: { type: 'string' }, aliases: { type: 'array', items: { type: 'string' } }, ...extra },
  required: ['name', 'aliases'],
  additionalProperties: false,
})
const ROSTER_SCHEMA = {
  type: 'object',
  properties: {
    characters: { type: 'array', items: ENTRY({ player: { type: 'boolean', description: 'True for the character the player plays; at most one.' } }) },
    places: { type: 'array', items: ENTRY({ parent: { type: 'string', description: 'The main name of the place this one is in, when it is in one.' } }) },
    factions: { type: 'array', items: ENTRY() },
    things: { type: 'array', items: ENTRY() },
  },
  required: ['characters', 'places', 'factions', 'things'],
  additionalProperties: false,
} as const

interface RosterAnswer {
  characters: { name: string; aliases: string[]; player?: boolean }[]
  places: { name: string; aliases: string[]; parent?: string }[]
  factions: { name: string; aliases: string[] }[]
  things: { name: string; aliases: string[] }[]
}

const MAX_ENTITIES = 200

function rosterCheck(answer: RosterAnswer): string | undefined {
  const all = [...answer.characters, ...answer.places, ...answer.factions, ...answer.things]
  if (all.length > MAX_ENTITIES) return `the list has ${all.length} entries; at most ${MAX_ENTITIES}`
  if (all.some(entry => entry.name.trim() === '' || entry.name.length > MAX_NAME || /\[PLAYER\]|\{\{\s*user\s*\}\}/i.test(entry.name))) return 'every entry needs a real name of at most 100 characters, and the player is never listed'
  for (const [kind, list] of [['characters', answer.characters], ['places', answer.places], ['factions', answer.factions], ['things', answer.things]] as const) {
    const seen = new Set<string>()
    for (const entry of list) {
      if (seen.has(norm(entry.name))) return `${kind}: "${entry.name}" is listed twice: merge it`
      seen.add(norm(entry.name))
    }
  }
  if (answer.characters.filter(entry => entry.player === true).length > 1) return 'at most one character is the player'
  return undefined
}

function rosterJob(text: TextOf, card: NormalizedCard, candidates: readonly Candidate[], titleIsBeing: string): ChildJob<RosterAnswer> {
  const lines = candidates.map(candidate => `${candidate.kind}: ${candidate.name} (${candidate.pieces.length} piece${candidate.pieces.length === 1 ? '' : 's'}${candidate.player ? ', about the player\'s character' : ''}${candidate.titles.length === 0 ? '' : `; titles: ${candidate.titles.join(' / ')}`})`)
  return {
    persona: text('import/roster'),
    prompt: `Card title: ${card.name}\n${titleIsBeing}\n\nNames found:\n${lines.join('\n')}`,
    result: ROSTER_SCHEMA as never,
    check: rosterCheck,
  }
}

/** Names that the text gives for one another in brackets ("A (also called B)"): the second is folded into the first when both are listed as the same kind. */
export function foldNamedAliases(answer: RosterAnswer, text: string): void {
  const flat = text.normalize('NFKC')
  const escape = (value: string): string => value.normalize('NFKC').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  for (const list of [answer.characters, answer.places, answer.factions, answer.things] as { name: string; aliases: string[]; player?: boolean }[][]) {
    for (let i = 0; i < list.length; i += 1) {
      for (let j = list.length - 1; j >= 0; j -= 1) {
        if (i === j || list[i] === undefined || list[j] === undefined || norm(list[j]!.name).length < 2 || norm(list[i]!.name).length < 2) continue
        const known = (entry: { name: string; aliases: string[] }): string[] => [entry.name, ...entry.aliases].filter(name => norm(name).length >= 2)
        const bracketed = known(list[i]!).some(first => known(list[j]!).some(second => new RegExp(`${escape(first)}\\s*[(（][^)）]{0,14}${escape(second)}\\s*[)）]`).test(flat)))
        if (!bracketed) continue
        list[i]!.aliases.push(list[j]!.name, ...list[j]!.aliases)
        if (list[j]!.player === true) list[i]!.player = true
        list.splice(j, 1)
        if (j < i) i -= 1
      }
    }
  }
}

/**
 * The list of everyone and everything the world is made of, keyed for the world's files. The names found in the pieces are merged by one call; when it fails
 * the names stand as found. The card's own title is a candidate too when the description is about a being by that name.
 */
export async function buildRoster(ctx: ImportContext, card: NormalizedCard, items: readonly SourceItem[], classified: Classified): Promise<{ roster: Roster; failure?: string }> {
  const candidates = candidatesOf(items, classified)
  const titleIsBeing = candidates.some(candidate => candidate.kind === 'character' && norm(candidate.name) === norm(card.name)) ? 'The pieces name the card title as a character.' : 'The card title is not named as a character by any piece.'
  let answer: RosterAnswer
  let failure: string | undefined
  try {
    answer = candidates.length === 0 ? { characters: [], places: [], factions: [], things: [] } : await ctx.run(rosterJob(ctx.text, card, candidates, titleIsBeing))
  } catch (error) {
    failure = `the list of names could not be merged: ${error instanceof Error ? error.message : String(error)}`
    const folded = foldContained(candidates.map(candidate => ({ ...candidate, pieces: [...candidate.pieces] })))
    const as = (kind: Kind) => folded.filter(entry => entry.candidate.kind === kind).map(entry => ({ name: entry.candidate.name, aliases: entry.aliases, ...(kind === 'character' ? { player: entry.candidate.player } : {}) }))
    answer = { characters: as('character'), places: as('place'), factions: as('faction'), things: as('thing') }
  }
  foldNamedAliases(answer, items.map(item => item.text).join('\n'))
  const supplied = new Set(candidates.filter(candidate => candidate.player).flatMap(candidate => [candidate.name, ...answer.characters.filter(entry => norm(entry.name) === norm(candidate.name)).flatMap(entry => entry.aliases)]).map(norm))
  for (const entry of answer.characters) if (entry.player === true && ![entry.name, ...entry.aliases].some(name => supplied.has(norm(name)))) entry.player = false
  const taken = new Set<string>()
  const entities: Roster = []
  const add = (kind: Kind, entry: { name: string; aliases: string[]; player?: boolean; parent?: string }): void => {
    const name = entry.name.trim()
    entities.push({
      kind,
      key: uniqueKey(slug(name, kind), taken),
      name,
      aliases: [...new Set(entry.aliases.map(alias => alias.trim()).filter(alias => alias !== '' && norm(alias) !== norm(name)))],
      player: kind === 'character' && entry.player === true,
      ...(entry.parent === undefined || entry.parent.trim() === '' ? {} : { parent: entry.parent.trim() }),
    })
  }
  for (const entry of answer.characters) add('character', entry)
  for (const entry of answer.places) add('place', entry)
  for (const entry of answer.factions) add('faction', entry)
  for (const entry of answer.things) add('thing', entry)
  return { roster: entities, ...(failure === undefined ? {} : { failure }) }
}

/** The entity a name stands for: by its name or an alias, the same when compared as names; otherwise one that contains it or is contained by it, when that is unambiguous. */
export function findEntity(roster: Roster, name: string, kind?: Kind): Entity | undefined {
  const wanted = norm(name)
  if (wanted === '') return undefined
  const pool = roster.filter(entity => kind === undefined || entity.kind === kind)
  const exact = pool.find(entity => [entity.name, ...entity.aliases].some(candidate => norm(candidate) === wanted))
  if (exact !== undefined) return exact
  if (wanted.length < 2) return undefined
  const near = pool.filter(entity => [entity.name, ...entity.aliases].some((candidate) => { const other = norm(candidate); return other.length >= 2 && (other.includes(wanted) || wanted.includes(other)) }))
  return near.length === 1 ? near[0] : undefined
}
