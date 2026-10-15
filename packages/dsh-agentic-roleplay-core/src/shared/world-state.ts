import { CHARACTER_ROLES, CHARACTER_TIERS, CHARACTER_KINDS, EXIT_STATES, INTENT_STATUSES, LORE_KINDS, MEMBERSHIP_STATUSES, type LoreKind, type LoreSubjectKind, type PlotDefinition, type PlotProgress, type TriggerCondition, type TriggerEffect, type TriggerStatus, type VisualIdentityInput } from 'dsh-roleplay-model'

/** One thing a character wants, as the World editor shows it. */
export interface WorldGoal {
  /** What names the goal when it is edited: its id in a session, its place in the list in a world's file. */
  ref: string
  name: string
  description: string
  status: (typeof INTENT_STATUSES)[number]
  priority: number
}

/** One character as the World editor shows it: who it is, and where it stands. In a session that is now; in a world, when the story begins. */
export interface WorldCharacter {
  /** The key the story uses for it. */
  key: string
  name: string
  aliases: string[]
  role: (typeof CHARACTER_ROLES)[number]
  tier: (typeof CHARACTER_TIERS)[number]
  kind: (typeof CHARACTER_KINDS)[number]
  /** Whether the player plays it, or an agent. A world's playable characters start as the player's. */
  control: 'player' | 'agent'
  age?: string
  gender?: string
  pronouns?: string
  summary: string
  personality: string
  background: string
  appearance: string
  speech: { style: string; examples: string[] }
  voice?: string
  /** The canonical picture of the character, when it has one. */
  portrait?: string
  visualIdentity?: VisualIdentityInput
  state: { publicState: string; innerState: string; activity: string }
  /** Where it stands, by the key of the place. */
  place?: { key: string; name: string; position?: string }
  goals: WorldGoal[]
}

/** A place a character can be put in. */
export interface WorldPlace {
  key: string
  name: string
  description: string
  parent?: { key: string; name: string }
  features: { key: string; name: string; description: string }[]
  visualIdentity?: VisualIdentityInput
}

export interface WorldThing {
  key: string
  name: string
  description: string
  quantity: number
  unique: boolean
  quality: string
  notable: boolean
  hidden: boolean
  wearable?: string
  containerState?: 'open' | 'closed' | 'locked'
  owner?: { key: string; name: string }
  holder: string
  visualIdentity?: VisualIdentityInput
}

/** A trigger as the editor shows it: what it waits for and does, and in a story how it stands. */
export interface WorldTrigger {
  key: string
  name: string
  when: TriggerCondition
  effects: TriggerEffect[]
  repeat: boolean
  priority: number
  cooldownSeconds?: number
  chance?: number
  expires?: string
  /** Whether what is coming is known beforehand by someone. */
  announced: boolean
  /** In a story: whether it fired, and how often. */
  status?: TriggerStatus
  fireCount?: number
  origin?: 'world' | 'story'
  /** What is wrong with it: a thing it names that the world does not have, or why it failed. */
  problems: string[]
}

export interface WorldState {
  narrationVoice?: string
  characters: WorldCharacter[]
  places: WorldPlace[]
  things: WorldThing[]
  factions: WorldFaction[]
  lore?: WorldLore[]
  triggers?: WorldTrigger[]
  /** What is wrong with `triggers.json` as a whole, when it cannot be read. */
  triggersProblem?: string
  plots: { definition: PlotDefinition; progress?: Omit<PlotProgress, 'plot'> }[]
  relations: WorldRelation[]
}

export interface PlotsEdit { plots: PlotDefinition[] }

export interface WorldLore {
  key: string
  title: string
  kind: LoreKind
  summary: string
  body: string
  startsAt?: number
  endsAt?: number
  subjects: { kind: LoreSubjectKind; key: string; name: string }[]
  related: { key: string; title: string }[]
  sources: string[]
}

export interface LoreEdit { title?: string; kind?: LoreKind; summary?: string; body?: string; startsAt?: number | null; endsAt?: number | null; sources?: string[] }

export interface RelationEntity {
  kind: 'character' | 'location' | 'item' | 'faction' | 'exit'
  key: string
  name: string
}

export type WorldRelation =
  | { key: string; kind: 'character'; from: RelationEntity; to: RelationEntity; label: string; summary: string; familiarity: number; trust: number; affinity: number; tension: number }
  | { key: string; kind: 'knowledge'; from: RelationEntity; to: RelationEntity; observed: boolean }
  | { key: string; kind: 'membership'; from: RelationEntity; to: RelationEntity; role: string; rank: string; status: (typeof MEMBERSHIP_STATUSES)[number]; public: boolean; commitment: number }
  | { key: string; kind: 'social'; from: RelationEntity; to: RelationEntity; label: string; summary: string; familiarity: number; trust: number; affinity: number; tension: number }
  | { key: string; kind: 'exit'; from: RelationEntity; to: RelationEntity; description: string; travelSeconds?: number; state: (typeof EXIT_STATES)[number]; note: string; oneWay?: boolean }

export type RelationEdit =
  | { key: string; kind: 'character'; remove?: boolean; label?: string; summary?: string; familiarity?: number; trust?: number; affinity?: number; tension?: number }
  | { key: string; kind: 'membership'; remove?: boolean; role?: string; rank?: string; status?: (typeof MEMBERSHIP_STATUSES)[number]; public?: boolean; commitment?: number }
  | { key: string; kind: 'social'; remove?: boolean; label?: string; summary?: string; familiarity?: number; trust?: number; affinity?: number; tension?: number }
  | { key: string; kind: 'exit'; remove?: boolean; description?: string; travelSeconds?: number | null; state?: (typeof EXIT_STATES)[number]; note?: string }
  | { key: string; kind: 'knowledge'; remove: boolean }

export type NewRelationEdit =
  | { create: true; kind: 'character'; from: string; to: string; label: string; summary?: string; familiarity?: number; trust?: number; affinity?: number; tension?: number }
  | { create: true; kind: 'knowledge'; from: string; toKind: 'location' | 'item' | 'exit'; to: string; observed?: boolean }
  | { create: true; kind: 'membership'; from: string; to: string; role: string; rank?: string; status?: (typeof MEMBERSHIP_STATUSES)[number]; public?: boolean; commitment?: number }
  | { create: true; kind: 'social'; fromKind: 'character' | 'faction'; from: string; toKind: 'character' | 'faction'; to: string; label: string; summary?: string; familiarity?: number; trust?: number; affinity?: number; tension?: number }
  | { create: true; kind: 'exit'; from: string; to: string; description: string; travelSeconds?: number; state?: (typeof EXIT_STATES)[number]; note?: string }

export type RelationChange = RelationEdit | NewRelationEdit

export interface WorldFaction {
  key: string
  name: string
  aliases: string[]
  summary: string
  description: string
  values: string[]
  structure: string
  state: { publicState: string; innerState: string }
  goals: WorldGoal[]
  members: { character: string; name: string; role: string; rank: string; status: 'active' | 'inactive' | 'former'; public: boolean; commitment: number }[]
  relationships: { target: string; label: string; summary: string }[]
}

export interface FactionEdit {
  name?: string
  aliases?: string[]
  summary?: string
  description?: string
  values?: string[]
  structure?: string
  state?: { publicState?: string; innerState?: string }
  goals?: CharacterEdit['goals']
}

export interface PlaceEdit {
  /** The key of the place that contains this one, or null for none. */
  parent?: string | null
  name?: string
  description?: string
  features?: WorldPlace['features']
  visualIdentity?: VisualIdentityInput | null
}

export interface ThingEdit {
  /** The key of the character it belongs to, or null for no one. */
  owner?: string | null
  name?: string
  description?: string
  quantity?: number
  quality?: string
  notable?: boolean
  hidden?: boolean
  containerState?: WorldThing['containerState']
  visualIdentity?: VisualIdentityInput | null
}

/** What the editor changes of a character: the fields given; the rest stays. A blank optional text takes it away. */
export interface CharacterEdit {
  name?: string
  aliases?: string[]
  age?: string
  gender?: string
  pronouns?: string
  role?: WorldCharacter['role']
  tier?: WorldCharacter['tier']
  kind?: WorldCharacter['kind']
  summary?: string
  personality?: string
  background?: string
  appearance?: string
  /** Stable visual facts used by the canonical portrait and scene images. */
  visualIdentity?: VisualIdentityInput | null
  speech?: { style?: string; examples?: string[] }
  voice?: string
  state?: { publicState?: string; innerState?: string; activity?: string }
  /** Where to stand, by the key of a place, and where in it. */
  place?: { location: string; position?: string }
  goals?: { ref: string; name?: string; description?: string; status?: WorldGoal['status']; priority?: number }[]
}

/** The problems with an edit, for the person who made it; nothing was changed. */
export class InvalidEditProblems extends Error {
  constructor(readonly problems: readonly string[]) {
    super(`the edit is not acceptable: ${problems.join('; ')}`)
  }
}

const TEXT_LIMIT = 20_000
const NAME_LIMIT = 200

/** Reads an edit from what the browser sent: every unknown or mistyped field is a problem. */
export function parseCharacterEdit(value: unknown): CharacterEdit {
  const problems: string[] = []
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new InvalidEditProblems(['the edit must be an object'])
  const input = value as Record<string, unknown>
  const edit: CharacterEdit = {}
  const text = (source: Record<string, unknown>, key: string, path: string, limit: number): string | undefined => {
    const found = source[key]
    if (found === undefined) return undefined
    if (typeof found !== 'string') { problems.push(`${path}${key} must be text`); return undefined }
    if (found.length > limit) { problems.push(`${path}${key} is longer than ${limit} characters`); return undefined }
    return found
  }
  const list = (source: Record<string, unknown>, key: string, path: string): string[] | undefined => {
    const found = source[key]
    if (found === undefined) return undefined
    if (!Array.isArray(found) || !found.every(entry => typeof entry === 'string' && entry.length <= NAME_LIMIT) || found.length > 50) { problems.push(`${path}${key} must be a list of short texts`); return undefined }
    return found as string[]
  }
  const choice = <T extends string>(key: string, options: readonly T[], source: Record<string, unknown> = input, path = ''): T | undefined => {
    const found = source[key]
    if (found === undefined) return undefined
    if (typeof found !== 'string' || !options.includes(found as T)) { problems.push(`${path}${key} must be one of: ${options.join(', ')}`); return undefined }
    return found as T
  }
  const allowed = (source: Record<string, unknown>, keys: readonly string[], path: string): void => {
    for (const key of Object.keys(source)) if (!keys.includes(key)) problems.push(`${path}${key} is not something that can be edited`)
  }
  allowed(input, ['name', 'aliases', 'age', 'gender', 'pronouns', 'role', 'tier', 'kind', 'summary', 'personality', 'background', 'appearance', 'voice', 'visualIdentity', 'speech', 'state', 'place', 'goals'], '')
  const name = text(input, 'name', '', NAME_LIMIT)
  if (name !== undefined) { if (name.trim() === '') problems.push('name cannot be blank'); else edit.name = name.trim() }
  const aliases = list(input, 'aliases', '')
  if (aliases !== undefined) edit.aliases = aliases
  for (const key of ['age', 'gender', 'pronouns'] as const) { const found = text(input, key, '', NAME_LIMIT); if (found !== undefined) edit[key] = found }
  const voice = text(input, 'voice', '', NAME_LIMIT); if (voice !== undefined) edit.voice = voice
  for (const key of ['summary', 'personality', 'background', 'appearance'] as const) { const found = text(input, key, '', TEXT_LIMIT); if (found !== undefined) edit[key] = found }
  const role = choice('role', CHARACTER_ROLES); if (role !== undefined) edit.role = role
  const tier = choice('tier', CHARACTER_TIERS); if (tier !== undefined) edit.tier = tier
  const kind = choice('kind', CHARACTER_KINDS); if (kind !== undefined) edit.kind = kind
  const object = (key: string): Record<string, unknown> | undefined => {
    const found = input[key]
    if (found === undefined) return undefined
    if (typeof found !== 'object' || found === null || Array.isArray(found)) { problems.push(`${key} must be an object`); return undefined }
    return found as Record<string, unknown>
  }
  if (input['visualIdentity'] === null) edit.visualIdentity = null
  else if (input['visualIdentity'] !== undefined) {
    const visual = object('visualIdentity')
    if (visual !== undefined) {
      allowed(visual, ['description', 'tags', 'negativeTags', 'globalId'], 'visualIdentity.')
      const description = text(visual, 'description', 'visualIdentity.', 2_000)
      const tags = list(visual, 'tags', 'visualIdentity.')
      const negativeTags = list(visual, 'negativeTags', 'visualIdentity.')
      const globalId = text(visual, 'globalId', 'visualIdentity.', NAME_LIMIT)
      if (description === undefined || description.trim() === '') problems.push('visualIdentity.description is needed')
      else edit.visualIdentity = { description: description.trim(), tags: tags ?? [], negativeTags: negativeTags ?? [], ...(globalId === undefined || globalId.trim() === '' ? {} : { globalId: globalId.trim() }) }
    }
  }
  const speech = object('speech')
  if (speech !== undefined) {
    allowed(speech, ['style', 'examples'], 'speech.')
    const style = text(speech, 'style', 'speech.', TEXT_LIMIT); const examples = list(speech, 'examples', 'speech.')
    edit.speech = { ...(style === undefined ? {} : { style }), ...(examples === undefined ? {} : { examples }) }
  }
  const state = object('state')
  if (state !== undefined) {
    allowed(state, ['publicState', 'innerState', 'activity'], 'state.')
    edit.state = {}
    for (const key of ['publicState', 'innerState', 'activity'] as const) { const found = text(state, key, 'state.', TEXT_LIMIT); if (found !== undefined) edit.state[key] = found }
  }
  const place = object('place')
  if (place !== undefined) {
    allowed(place, ['location', 'position'], 'place.')
    const location = text(place, 'location', 'place.', NAME_LIMIT); const position = text(place, 'position', 'place.', NAME_LIMIT)
    if (location === undefined || location.trim() === '') problems.push('place.location is needed')
    else edit.place = { location, ...(position === undefined ? {} : { position }) }
  }
  if (input['goals'] !== undefined) {
    if (!Array.isArray(input['goals'])) problems.push('goals must be a list')
    else {
      const goals: NonNullable<CharacterEdit['goals']> = []
      edit.goals = goals
      input['goals'].forEach((entry: unknown, index) => {
        if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) { problems.push(`goals[${index}] must be an object`); return }
        const goal = entry as Record<string, unknown>
        const path = `goals[${index}].`
        allowed(goal, ['ref', 'name', 'description', 'status', 'priority'], path)
        const ref = text(goal, 'ref', path, NAME_LIMIT)
        if (ref === undefined) { problems.push(`${path}ref is needed`); return }
        const goalName = text(goal, 'name', path, NAME_LIMIT)
        if (goalName !== undefined && goalName.trim() === '') problems.push(`${path}name cannot be blank`)
        const description = text(goal, 'description', path, TEXT_LIMIT)
        const status = choice('status', INTENT_STATUSES, goal, path)
        const priority = goal['priority']
        if (priority !== undefined && (typeof priority !== 'number' || !Number.isFinite(priority) || priority < 0 || priority > 1)) problems.push(`${path}priority must be a number from 0 to 1`)
        goals.push({ ref, ...(goalName === undefined ? {} : { name: goalName.trim() }), ...(description === undefined ? {} : { description }), ...(status === undefined ? {} : { status }), ...(typeof priority === 'number' ? { priority } : {}) })
      })
    }
  }
  if (problems.length > 0) throw new InvalidEditProblems(problems)
  return edit
}

function parseEntityEdit(value: unknown, kind: 'place' | 'thing'): PlaceEdit | ThingEdit {
  const problems: string[] = []
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new InvalidEditProblems(['the edit must be an object'])
  const input = value as Record<string, unknown>
  const edit: Record<string, unknown> = {}
  const allowed = kind === 'place' ? ['name', 'description', 'features', 'visualIdentity', 'parent'] : ['name', 'description', 'quantity', 'quality', 'notable', 'hidden', 'containerState', 'visualIdentity', 'owner']
  const link = kind === 'place' ? 'parent' : 'owner'
  if (link in input) {
    const target = input[link]
    if (target === null) edit[link] = null
    else if (typeof target !== 'string') problems.push(`${link} must be a key or null`)
    else edit[link] = target.trim() === '' ? null : target.trim()
  }
  for (const key of Object.keys(input)) if (!allowed.includes(key)) problems.push(`${key} is not something that can be edited`)
  for (const key of ['name', 'description', 'quality'] as const) {
    if (!(key in input)) continue
    const value = input[key]
    if (typeof value !== 'string' || value.length > (key === 'name' ? NAME_LIMIT : TEXT_LIMIT)) problems.push(`${key} must be text`)
    else if (key === 'name' && value.trim() === '') problems.push('name cannot be blank')
    else edit[key] = key === 'name' ? value.trim() : value
  }
  for (const key of ['notable', 'hidden'] as const) if (key in input) {
    if (typeof input[key] !== 'boolean') problems.push(`${key} must be true or false`)
    else edit[key] = input[key]
  }
  if ('quantity' in input) {
    const quantity = input['quantity']
    if (typeof quantity !== 'number' || !Number.isInteger(quantity) || quantity < 1) problems.push('quantity must be a whole number from 1')
    else edit['quantity'] = quantity
  }
  if ('containerState' in input) {
    const state = input['containerState']
    if (state !== 'open' && state !== 'closed' && state !== 'locked') problems.push('containerState must be one of: open, closed, locked')
    else edit['containerState'] = state
  }
  if ('features' in input) {
    const features = input['features']
    if (!Array.isArray(features) || features.length > 30 || !features.every(feature => typeof feature === 'object' && feature !== null && typeof (feature as Record<string, unknown>)['key'] === 'string' && typeof (feature as Record<string, unknown>)['name'] === 'string' && typeof (feature as Record<string, unknown>)['description'] === 'string')) problems.push('features must be a list of named features')
    else edit['features'] = features
  }
  if (input['visualIdentity'] === null) edit['visualIdentity'] = null
  else if ('visualIdentity' in input) {
    const identity = input['visualIdentity']
    if (typeof identity !== 'object' || identity === null || Array.isArray(identity)) problems.push('visualIdentity must be an object')
    else {
      const visual = identity as Record<string, unknown>
      const description = visual['description']; const tags = visual['tags']; const negativeTags = visual['negativeTags']; const globalId = visual['globalId']
      if (typeof description !== 'string' || description.trim() === '') problems.push('visualIdentity.description is needed')
      else if (!Array.isArray(tags) || !tags.every(value => typeof value === 'string') || !Array.isArray(negativeTags) || !negativeTags.every(value => typeof value === 'string') || (globalId !== undefined && typeof globalId !== 'string')) problems.push('visualIdentity has invalid fields')
      else edit['visualIdentity'] = { description: description.trim(), tags, negativeTags, ...(globalId === undefined || globalId.trim() === '' ? {} : { globalId: globalId.trim() }) }
    }
  }
  if (problems.length > 0) throw new InvalidEditProblems(problems)
  return edit
}

export const parsePlaceEdit = (value: unknown): PlaceEdit => parseEntityEdit(value, 'place') as PlaceEdit
export const parseThingEdit = (value: unknown): ThingEdit => parseEntityEdit(value, 'thing') as ThingEdit

export function parseFactionEdit(value: unknown): FactionEdit {
  const problems: string[] = []
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new InvalidEditProblems(['the edit must be an object'])
  const input = value as Record<string, unknown>
  const allowed = ['name', 'aliases', 'summary', 'description', 'values', 'structure', 'state', 'goals']
  for (const key of Object.keys(input)) if (!allowed.includes(key)) problems.push(`${key} is not something that can be edited`)
  const edit: FactionEdit = {}
  for (const key of ['name', 'summary', 'description', 'structure'] as const) if (key in input) {
    const found = input[key]
    if (typeof found !== 'string' || found.length > TEXT_LIMIT) problems.push(`${key} must be text`)
    else if (key === 'name' && found.trim() === '') problems.push('name cannot be blank')
    else edit[key] = key === 'name' ? found.trim() : found
  }
  for (const key of ['aliases', 'values'] as const) if (key in input) {
    const found = input[key]
    if (!Array.isArray(found) || !found.every(entry => typeof entry === 'string' && entry.length <= NAME_LIMIT)) problems.push(`${key} must be a list of short texts`)
    else edit[key] = found as string[]
  }
  if ('state' in input) {
    const state = input['state']
    if (typeof state !== 'object' || state === null || Array.isArray(state)) problems.push('state must be an object')
    else {
      const record = state as Record<string, unknown>; edit.state = {}
      for (const key of ['publicState', 'innerState'] as const) if (key in record) { if (typeof record[key] !== 'string') problems.push(`state.${key} must be text`); else edit.state[key] = record[key] as string }
    }
  }
  if ('goals' in input) {
    try { edit.goals = parseCharacterEdit({ goals: input['goals'] }).goals } catch (error) { if (error instanceof InvalidEditProblems) problems.push(...error.problems); else throw error }
  }
  if (problems.length > 0) throw new InvalidEditProblems(problems)
  return edit
}

export function parseLoreEdit(value: unknown): LoreEdit {
  const problems: string[] = []
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new InvalidEditProblems(['the edit must be an object'])
  const input = value as Record<string, unknown>; const edit: LoreEdit = {}
  for (const key of Object.keys(input)) if (!['title', 'kind', 'summary', 'body', 'startsAt', 'endsAt', 'sources'].includes(key)) problems.push(`${key} is not something that can be edited`)
  for (const key of ['title', 'summary', 'body'] as const) if (key in input) { const found = input[key]; if (typeof found !== 'string' || found.length > TEXT_LIMIT) problems.push(`${key} must be text`); else if (key === 'title' && found.trim() === '') problems.push('title cannot be blank'); else edit[key] = key === 'title' ? found.trim() : found }
  if ('kind' in input) { if (typeof input['kind'] !== 'string' || !LORE_KINDS.includes(input['kind'] as LoreKind)) problems.push(`kind must be one of: ${LORE_KINDS.join(', ')}`); else edit.kind = input['kind'] as LoreKind }
  for (const key of ['startsAt', 'endsAt'] as const) if (key in input) { const found = input[key]; if (found !== null && (typeof found !== 'number' || !Number.isFinite(found))) problems.push(`${key} must be a timestamp or null`); else edit[key] = found as number | null }
  if ('sources' in input) { const found = input['sources']; if (!Array.isArray(found) || !found.every(entry => typeof entry === 'string' && entry.length <= TEXT_LIMIT)) problems.push('sources must be a list of texts'); else edit.sources = found as string[] }
  const starts = edit.startsAt === null ? undefined : edit.startsAt; const ends = edit.endsAt === null ? undefined : edit.endsAt
  if (starts !== undefined && ends !== undefined && ends < starts) problems.push('endsAt must not be before startsAt')
  if (problems.length > 0) throw new InvalidEditProblems(problems)
  return edit
}

export function parseRelationEdit(value: unknown): RelationChange {
  const problems: string[] = []
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new InvalidEditProblems(['the edit must be an object'])
  const input = value as Record<string, unknown>
  const kind = input['kind']
  const key = input['key']
  if (!['character', 'knowledge', 'membership', 'social', 'exit'].includes(String(kind))) problems.push('kind is not a relation kind')
  const creating = input['create'] === true
  if (!creating && (typeof key !== 'string' || key.trim() === '' || key.length > 500)) problems.push('key is needed')
  if (!creating && typeof key === 'string' && key.trim() !== '' && typeof input['from'] === 'string' && typeof input['to'] === 'string' && input['remove'] !== true) problems.push('to make a new relationship send create: true with from and to and no key; a key names one that exists, exactly as list_relationships shows it')
  if ('create' in input && typeof input['create'] !== 'boolean') problems.push('create must be true or false')
  const allowedByKind: Record<string, string[]> = {
    character: ['kind', 'key', 'create', 'from', 'to', 'remove', 'label', 'summary', 'familiarity', 'trust', 'affinity', 'tension'],
    knowledge: ['kind', 'key', 'create', 'from', 'toKind', 'to', 'observed', 'remove'],
    membership: ['kind', 'key', 'create', 'from', 'to', 'remove', 'role', 'rank', 'status', 'public', 'commitment'],
    social: ['kind', 'key', 'create', 'fromKind', 'from', 'toKind', 'to', 'remove', 'label', 'summary', 'familiarity', 'trust', 'affinity', 'tension'],
    exit: ['kind', 'key', 'create', 'from', 'to', 'remove', 'description', 'travelSeconds', 'state', 'note'],
  }
  for (const field of Object.keys(input)) if (!(allowedByKind[String(kind)] ?? []).includes(field)) problems.push(`${field} is not something that can be edited`)
  if ('remove' in input && typeof input['remove'] !== 'boolean') problems.push('remove must be true or false')
  for (const field of ['label', 'summary', 'role', 'rank', 'description', 'note'] as const) if (field in input && (typeof input[field] !== 'string' || input[field].length > TEXT_LIMIT)) problems.push(`${field} must be text`)
  for (const field of ['familiarity', 'trust', 'affinity', 'tension', 'commitment'] as const) if (field in input) {
    const number = input[field]
    const signed = field === 'trust' || field === 'affinity'
    if (typeof number !== 'number' || !Number.isFinite(number) || number < (signed ? -1 : 0) || number > 1) problems.push(`${field} must be between ${signed ? '-1' : '0'} and 1`)
  }
  if ('travelSeconds' in input && input['travelSeconds'] !== null && (typeof input['travelSeconds'] !== 'number' || !Number.isInteger(input['travelSeconds']) || input['travelSeconds'] < 0)) problems.push('travelSeconds must be a non-negative whole number or null')
  if ('public' in input && typeof input['public'] !== 'boolean') problems.push('public must be true or false')
  if ('observed' in input && typeof input['observed'] !== 'boolean') problems.push('observed must be true or false')
  if ('status' in input) {
    const choices = kind === 'exit' ? EXIT_STATES : MEMBERSHIP_STATUSES
    if (typeof input['status'] !== 'string' || !choices.includes(input['status'] as never)) problems.push(`status must be one of: ${choices.join(', ')}`)
  }
  if (creating) {
    for (const field of ['from', 'to'] as const) if (typeof input[field] !== 'string' || input[field].trim() === '') problems.push(`${field} is needed`)
    if ((kind === 'character' || kind === 'social') && (typeof input['label'] !== 'string' || input['label'].trim() === '')) problems.push('label is needed')
    if (kind === 'membership' && (typeof input['role'] !== 'string' || input['role'].trim() === '')) problems.push('role is needed')
    if (kind === 'exit' && typeof input['description'] !== 'string') problems.push('description is needed')
    if (kind === 'knowledge' && !['location', 'item', 'exit'].includes(String(input['toKind']))) problems.push('toKind must be one of: location, item, exit')
    if (kind === 'social') for (const field of ['fromKind', 'toKind'] as const) if (!['character', 'faction'].includes(String(input[field]))) problems.push(`${field} must be character or faction`)
  } else if (kind === 'knowledge' && input['remove'] !== true) problems.push('knowledge editing supports creation or removal')
  if (problems.length > 0) throw new InvalidEditProblems(problems)
  return input as unknown as RelationChange
}
