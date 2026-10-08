import { existsSync, statSync } from 'node:fs'
import { stat } from 'node:fs/promises'
import type { ImageGenerationService } from 'dsh-ai-core'
import { isSessionId, sessionDatabase, sessionFolder, type RoleplayState, type Session } from 'dsh-roleplay-state'
import { InvalidEditProblems, type CharacterEdit, type FactionEdit, type LoreEdit, type NewRelationEdit, type PlaceEdit, type RelationChange, type RelationEntity, type ThingEdit, type WorldCharacter, type WorldRelation, type WorldState } from '../../shared/world-state.ts'
import { SessionNotFoundError } from './errors.ts'
import { API_PREFIX } from '../../shared/worlds.ts'
import { referenceImagePath } from '../images/storage.ts'
import { generateReferenceImage } from '../images/generator.ts'

export interface WorldStateDeps {
  state: Pick<RoleplayState, 'openSession'>
  sessionsDir: () => string
}

function sessionOf(deps: WorldStateDeps, id: string): Session {
  const directory = deps.sessionsDir()
  if (!isSessionId(id) || !existsSync(sessionDatabase(directory, id))) throw new SessionNotFoundError(`no session "${id}"`)
  return deps.state.openSession(directory, id)
}

const keyOf = (character: { sourceId?: string; id: number }): string => character.sourceId ?? String(character.id)

function worldOf(session: Session, sessionsDir: string): WorldState {
  const narrationVoice = session.metadata.getValue('roleplay.tts.narrationVoice')
  const characters = session.characters.list().map((character): WorldCharacter => {
    const state = session.characterStates.get(character.id)
    const placement = session.placements.get('character', character.id)
    const location = placement === undefined ? undefined : session.locations.get(placement.locationId)
    const visualIdentity = session.visualIdentities.get('character', character.id)
    const portrait = referenceImagePath(sessionFolder(sessionsDir, session.metadata.get().id), { kind: 'character', localId: character.sourceId ?? character.id, ...(visualIdentity?.globalId === undefined ? {} : { globalId: visualIdentity.globalId }) })
    return {
      key: keyOf(character),
      name: character.name,
      aliases: character.aliases,
      role: character.role,
      tier: character.tier,
      kind: character.kind,
      control: character.control,
      ...(character.age === undefined ? {} : { age: character.age }),
      ...(character.gender === undefined ? {} : { gender: character.gender }),
      ...(character.pronouns === undefined ? {} : { pronouns: character.pronouns }),
      summary: character.summary,
      personality: character.personality,
      background: character.background,
      appearance: character.appearance,
      speech: character.speech,
      ...(character.voice === undefined ? {} : { voice: character.voice }),
      ...(visualIdentity === undefined ? {} : { visualIdentity: { description: visualIdentity.description, tags: visualIdentity.tags, negativeTags: visualIdentity.negativeTags, ...(visualIdentity.globalId === undefined ? {} : { globalId: visualIdentity.globalId }) } }),
      ...(existsSync(portrait) ? { portrait: `/${API_PREFIX}/sessions/world/character/portrait/file?id=${encodeURIComponent(session.metadata.get().id)}&key=${encodeURIComponent(keyOf(character))}&v=${statSync(portrait).mtimeMs}` } : {}),
      state: { publicState: state?.publicState ?? '', innerState: state?.innerState ?? '', activity: state?.activity ?? '' },
      ...(location === undefined || placement === undefined ? {} : { place: { key: location.sourceId ?? String(location.id), name: location.name, ...(placement.position === '' ? {} : { position: placement.position }) } }),
      goals: session.intents.list(character.id).map(intent => ({ ref: String(intent.id), name: intent.name, description: intent.description, status: intent.status, priority: intent.priority })),
    }
  })
  const locationName = (id: number): string => session.locations.get(id)?.name ?? String(id)
  const characterName = (id: number): string => session.characters.get(id)?.name ?? String(id)
  const itemName = (id: number): string => session.items.get(id)?.name ?? String(id)
  const places = session.locations.list().map(location => {
    const visual = session.visualIdentities.get('location', location.id)
    return { key: location.sourceId ?? String(location.id), name: location.name, description: location.description, ...(location.parentId === undefined ? {} : { parent: { key: session.locations.get(location.parentId)?.sourceId ?? String(location.parentId), name: locationName(location.parentId) } }), features: location.features, ...(visual === undefined ? {} : { visualIdentity: { description: visual.description, tags: visual.tags, negativeTags: visual.negativeTags, ...(visual.globalId === undefined ? {} : { globalId: visual.globalId }) } }) }
  })
  const things = session.items.list().map(item => {
    const visual = session.visualIdentities.get('item', item.id)
    const holding = session.items.holding(item.id)?.holder
    const holder = holding === undefined ? '' : holding.kind === 'location' ? locationName(holding.locationId) : holding.kind === 'item' ? itemName(holding.itemId) : characterName(holding.characterId)
    return { key: item.sourceId ?? String(item.id), name: item.name, description: item.description, quantity: item.quantity, unique: item.unique, quality: item.quality, notable: item.notable, hidden: item.hidden, ...(item.wearableSlot === undefined ? {} : { wearable: item.wearableSlot }), ...(item.container === undefined ? {} : { containerState: item.container.state }), ...(item.ownerId === undefined ? {} : { owner: { key: session.characters.get(item.ownerId)?.sourceId ?? String(item.ownerId), name: characterName(item.ownerId) } }), holder, ...(visual === undefined ? {} : { visualIdentity: { description: visual.description, tags: visual.tags, negativeTags: visual.negativeTags, ...(visual.globalId === undefined ? {} : { globalId: visual.globalId }) } }) }
  })
  const factions = session.factions.list().map(faction => {
    const state = session.factionStates.get(faction.id)
    return { key: faction.sourceId ?? String(faction.id), name: faction.name, aliases: faction.aliases, summary: faction.summary, description: faction.description, values: faction.values, structure: faction.structure, state: { publicState: state?.publicState ?? '', innerState: state?.innerState ?? '' }, goals: session.factionIntents.list(faction.id).map(goal => ({ ref: String(goal.id), name: goal.name, description: goal.description, status: goal.status, priority: goal.priority })), members: session.factionMemberships.ofFaction(faction.id).map(member => { const character = session.characters.get(member.characterId); return { character: character?.sourceId ?? String(member.characterId), name: character?.name ?? String(member.characterId), role: member.role, rank: member.rank, status: member.status, public: member.public, commitment: member.commitment } }), relationships: session.factionRelationships.from('faction', faction.id).map(relationship => ({ target: `${relationship.toKind}:${relationship.toKind === 'faction' ? session.factions.get(relationship.toId)?.name ?? relationship.toId : session.characters.get(relationship.toId)?.name ?? relationship.toId}`, label: relationship.label, summary: relationship.summary })) }
  })
  const lore = session.lore.list().map(entry => ({ key: entry.sourceId ?? String(entry.id), title: entry.title, kind: entry.kind, summary: entry.summary, body: entry.body, ...(entry.startsAt === undefined ? {} : { startsAt: entry.startsAt }), ...(entry.endsAt === undefined ? {} : { endsAt: entry.endsAt }), subjects: entry.subjects.map(subject => ({ kind: subject.kind, key: String(subject.id), name: subjectName(session, subject.kind, subject.id) })), related: entry.related.flatMap(id => { const found = session.lore.get(id); return found === undefined ? [] : [{ key: found.sourceId ?? String(found.id), title: found.title }] }), sources: entry.sources }))
  const entity = (kind: RelationEntity['kind'], key: string, name: string): RelationEntity => ({ kind, key, name })
  const characterEntity = (id: number) => { const value = session.characters.get(id); return entity('character', value === undefined ? String(id) : keyOf(value), value?.name ?? String(id)) }
  const factionEntity = (id: number) => { const value = session.factions.get(id); return entity('faction', value?.sourceId ?? String(id), value?.name ?? String(id)) }
  const locationEntity = (id: number) => { const value = session.locations.get(id); return entity('location', value?.sourceId ?? String(id), value?.name ?? String(id)) }
  const relations: WorldRelation[] = []
  for (const relation of session.relationships.list()) relations.push({ key: relationKey('character', String(relation.fromId), String(relation.toId)), kind: 'character', from: characterEntity(relation.fromId), to: characterEntity(relation.toId), label: relation.label, summary: relation.summary, familiarity: relation.familiarity, trust: relation.trust, affinity: relation.affinity, tension: relation.tension })
  for (const character of session.characters.list()) for (const knowledge of session.knowledge.list(character.id)) {
    if (knowledge.subjectKind === 'lore') continue
    const target = knowledge.subjectKind === 'location' ? locationEntity(knowledge.subjectId) : knowledge.subjectKind === 'item' ? (() => { const value = session.items.get(knowledge.subjectId); return entity('item', value?.sourceId ?? String(knowledge.subjectId), value?.name ?? String(knowledge.subjectId)) })() : (() => { const value = session.locations.allExits().find(exit => exit.id === knowledge.subjectId); return entity('exit', String(knowledge.subjectId), value === undefined ? String(knowledge.subjectId) : `${locationName(value.fromId)} → ${locationName(value.toId)}`) })()
    relations.push({ key: relationKey('knowledge', String(character.id), knowledge.subjectKind, String(knowledge.subjectId)), kind: 'knowledge', from: characterEntity(character.id), to: target, observed: knowledge.lastObservedTurn !== undefined })
  }
  for (const faction of session.factions.list()) for (const member of session.factionMemberships.ofFaction(faction.id)) relations.push({ key: relationKey('membership', String(faction.id), String(member.characterId)), kind: 'membership', from: characterEntity(member.characterId), to: factionEntity(faction.id), role: member.role, rank: member.rank, status: member.status, public: member.public, commitment: member.commitment })
  for (const relation of session.factionRelationships.list()) relations.push({ key: relationKey('social', relation.fromKind, String(relation.fromId), relation.toKind, String(relation.toId)), kind: 'social', from: relation.fromKind === 'faction' ? factionEntity(relation.fromId) : characterEntity(relation.fromId), to: relation.toKind === 'faction' ? factionEntity(relation.toId) : characterEntity(relation.toId), label: relation.label, summary: relation.summary, familiarity: relation.familiarity, trust: relation.trust, affinity: relation.affinity, tension: relation.tension })
  for (const exit of session.locations.allExits()) relations.push({ key: relationKey('exit', String(exit.id)), kind: 'exit', from: locationEntity(exit.fromId), to: locationEntity(exit.toId), description: exit.description, ...(exit.travelSeconds === undefined ? {} : { travelSeconds: exit.travelSeconds }), state: exit.state, note: exit.note })
  return { ...(typeof narrationVoice === 'string' ? { narrationVoice } : {}), characters, places, things, factions, lore, relations }
}

function subjectName(session: Session, kind: 'character' | 'faction' | 'location' | 'item' | 'lore', id: number): string {
  return kind === 'character' ? session.characters.get(id)?.name ?? String(id) : kind === 'faction' ? session.factions.get(id)?.name ?? String(id) : kind === 'location' ? session.locations.get(id)?.name ?? String(id) : kind === 'item' ? session.items.get(id)?.name ?? String(id) : session.lore.get(id)?.title ?? String(id)
}

export function editWorldLore(deps: WorldStateDeps, id: string, key: string, edit: LoreEdit): WorldState {
  const session = sessionOf(deps, id); const entry = session.lore.list().find(candidate => (candidate.sourceId ?? String(candidate.id)) === key)
  if (entry === undefined) throw new InvalidEditProblems([`there is no lore "${key}"`])
  session.lore.update(entry.id, edit)
  return worldOf(session, deps.sessionsDir())
}

export function editSessionNarrationVoice(deps: WorldStateDeps, id: string, voice: string): WorldState {
  const session = sessionOf(deps, id)
  if (voice.trim() === '') session.metadata.deleteValue('roleplay.tts.narrationVoice'); else session.metadata.setValue('roleplay.tts.narrationVoice', voice.trim())
  return worldOf(session, deps.sessionsDir())
}

const relationKey = (...parts: string[]): string => parts.map(part => encodeURIComponent(part)).join(':')
const relationParts = (key: string): string[] => key.split(':').map(part => decodeURIComponent(part))

/**
 * What the World editor shows of a session: its characters as they are now, and the places they can be put in.
 * @throws {SessionNotFoundError} when the id names no session.
 */
export function readWorldState(deps: WorldStateDeps, id: string): WorldState {
  return worldOf(sessionOf(deps, id), deps.sessionsDir())
}

/**
 * Change a character of a session, all of it or none of it, and say how the world stands after.
 * @throws {SessionNotFoundError} when the id names no session. @throws {InvalidEditProblems} when the character, a place or a goal is not there, or the result is not allowed.
 */
export function editWorldCharacter(deps: WorldStateDeps, id: string, key: string, edit: CharacterEdit): WorldState {
  const session = sessionOf(deps, id)
  const character = session.characters.list().find(candidate => keyOf(candidate) === key)
  if (character === undefined) throw new InvalidEditProblems([`there is no character "${key}"`])
  const problems: string[] = []
  const place = edit.place === undefined ? undefined : session.locations.getBySourceId(edit.place.location)
  if (edit.place !== undefined && place === undefined) problems.push(`there is no place "${edit.place.location}"`)
  const own = new Set(session.intents.list(character.id).map(intent => String(intent.id)))
  for (const goal of edit.goals ?? []) if (!own.has(goal.ref)) problems.push(`${character.name} has no goal "${goal.ref}"`)
  if (problems.length > 0) throw new InvalidEditProblems(problems)
  try {
    session.transaction(() => {
      const { state, place: where, goals, speech, aliases, visualIdentity, ...definition } = edit
      const patch = { ...definition, ...(aliases === undefined ? {} : { aliases: aliases.map(alias => alias.trim()).filter(alias => alias !== '') }), ...(speech === undefined ? {} : { speech: { style: speech.style ?? character.speech.style, examples: (speech.examples ?? character.speech.examples).map(example => example.trim()).filter(example => example !== '') } }) }
      if (Object.keys(patch).length > 0) session.characters.update(character.id, patch)
      if (visualIdentity === null) session.visualIdentities.remove('character', character.id)
      else if (visualIdentity !== undefined) session.visualIdentities.set('character', character.id, visualIdentity)
      if (state !== undefined && Object.keys(state).length > 0) session.characterStates.update(character.id, state)
      if (where !== undefined && place !== undefined) session.placements.place('character', character.id, { locationId: place.id, position: where.position ?? '' })
      for (const goal of goals ?? []) {
        const { ref, ...changes } = goal
        if (Object.keys(changes).length > 0) session.intents.update(Number(ref), changes)
      }
    })
  } catch (error) {
    if (error instanceof Error && error.name === 'InvalidValueError') throw new InvalidEditProblems([error.message])
    throw error
  }
  return worldOf(session, deps.sessionsDir())
}

export function editWorldPlace(deps: WorldStateDeps, id: string, key: string, edit: PlaceEdit): WorldState {
  const session = sessionOf(deps, id)
  const place = session.locations.list().find(candidate => (candidate.sourceId ?? String(candidate.id)) === key)
  if (place === undefined) throw new InvalidEditProblems([`there is no place "${key}"`])
  try {
    session.transaction(() => {
      const { visualIdentity, ...patch } = edit
      if (Object.keys(patch).length > 0) session.locations.update(place.id, patch)
      if (visualIdentity === null) session.visualIdentities.remove('location', place.id)
      else if (visualIdentity !== undefined) session.visualIdentities.set('location', place.id, visualIdentity)
    })
  } catch (error) {
    if (error instanceof Error && (error.name === 'InvalidValueError' || error.name === 'ConflictError')) throw new InvalidEditProblems([error.message])
    throw error
  }
  return worldOf(session, deps.sessionsDir())
}

export function editWorldThing(deps: WorldStateDeps, id: string, key: string, edit: ThingEdit): WorldState {
  const session = sessionOf(deps, id)
  const item = session.items.list().find(candidate => (candidate.sourceId ?? String(candidate.id)) === key)
  if (item === undefined) throw new InvalidEditProblems([`there is no thing "${key}"`])
  try {
    session.transaction(() => {
      const { visualIdentity, containerState, ...patch } = edit
      const changes = { ...patch, ...(containerState === undefined ? {} : { container: { state: containerState } }) }
      if (Object.keys(changes).length > 0) session.items.update(item.id, changes)
      if (visualIdentity === null) session.visualIdentities.remove('item', item.id)
      else if (visualIdentity !== undefined) session.visualIdentities.set('item', item.id, visualIdentity)
    })
  } catch (error) {
    if (error instanceof Error && (error.name === 'InvalidValueError' || error.name === 'ConflictError')) throw new InvalidEditProblems([error.message])
    throw error
  }
  return worldOf(session, deps.sessionsDir())
}

export function editWorldFaction(deps: WorldStateDeps, id: string, key: string, edit: FactionEdit): WorldState {
  const session = sessionOf(deps, id)
  const faction = session.factions.list().find(candidate => (candidate.sourceId ?? String(candidate.id)) === key)
  if (faction === undefined) throw new InvalidEditProblems([`there is no faction "${key}"`])
  try {
    session.transaction(() => {
      const { state, goals, ...definition } = edit
      if (Object.keys(definition).length > 0) session.factions.update(faction.id, definition)
      if (state !== undefined && Object.keys(state).length > 0) session.factionStates.update(faction.id, state)
      for (const goal of goals ?? []) { const { ref, ...changes } = goal; if (Object.keys(changes).length > 0) session.factionIntents.update(Number(ref), changes) }
    })
  } catch (error) { if (error instanceof Error && (error.name === 'InvalidValueError' || error.name === 'ConflictError')) throw new InvalidEditProblems([error.message]); throw error }
  return worldOf(session, deps.sessionsDir())
}

export function editWorldRelation(deps: WorldStateDeps, id: string, edit: RelationChange): WorldState {
  const session = sessionOf(deps, id)
  if (isNewRelation(edit)) return createSessionRelation(session, deps.sessionsDir(), edit)
  const parts = relationParts(edit.key)
  if (parts[0] !== edit.kind) throw new InvalidEditProblems(['the relation key does not match its kind'])
  const number = (value: string | undefined): number => { const parsed = Number(value); if (!Number.isInteger(parsed)) throw new InvalidEditProblems(['the relation key is invalid']); return parsed }
  const turn = session.metadata.get().turns
  try {
    session.transaction(() => {
      if (edit.kind === 'character') {
        const from = number(parts[1]); const to = number(parts[2])
        if (edit.remove === true) session.relationships.remove(from, to)
        else { const { key: _, kind: __, remove: ___, ...patch } = edit; session.relationships.upsert(from, to, patch, turn) }
      } else if (edit.kind === 'knowledge') {
        session.knowledge.forget(number(parts[1]), parts[2] as 'location' | 'item' | 'exit', number(parts[3]))
      } else if (edit.kind === 'membership') {
        const faction = number(parts[1]); const character = number(parts[2])
        if (edit.remove === true) session.factionMemberships.remove(faction, character)
        else { const { key: _, kind: __, remove: ___, ...patch } = edit; session.factionMemberships.upsert(faction, character, patch, turn) }
      } else if (edit.kind === 'social') {
        const fromKind = parts[1] as 'character' | 'faction'; const from = number(parts[2]); const toKind = parts[3] as 'character' | 'faction'; const to = number(parts[4])
        if (edit.remove === true) session.factionRelationships.remove(fromKind, from, toKind, to)
        else { const { key: _, kind: __, remove: ___, ...patch } = edit; session.factionRelationships.upsert(fromKind, from, toKind, to, patch, turn) }
      } else {
        const exit = number(parts[1])
        if (edit.remove === true) session.locations.removeExit(exit)
        else { const { key: _, kind: __, remove: ___, ...patch } = edit; session.locations.updateExit(exit, patch) }
      }
    })
  } catch (error) { if (error instanceof Error && ['InvalidValueError', 'ConflictError', 'NotFoundError'].includes(error.name)) throw new InvalidEditProblems([error.message]); throw error }
  return worldOf(session, deps.sessionsDir())
}

const isNewRelation = (edit: RelationChange): edit is NewRelationEdit => 'create' in edit && edit.create === true

function createSessionRelation(session: Session, sessionsDir: string, edit: NewRelationEdit): WorldState {
  const character = (key: string) => { const found = session.characters.getBySourceId(key) ?? (Number.isInteger(Number(key)) ? session.characters.get(Number(key)) : undefined); if (found === undefined) throw new InvalidEditProblems([`there is no character "${key}"`]); return found.id }
  const faction = (key: string) => { const found = session.factions.getBySourceId(key) ?? (Number.isInteger(Number(key)) ? session.factions.get(Number(key)) : undefined); if (found === undefined) throw new InvalidEditProblems([`there is no faction "${key}"`]); return found.id }
  const location = (key: string) => { const found = session.locations.getBySourceId(key) ?? (Number.isInteger(Number(key)) ? session.locations.get(Number(key)) : undefined); if (found === undefined) throw new InvalidEditProblems([`there is no place "${key}"`]); return found.id }
  const social = (kind: 'character' | 'faction', key: string) => kind === 'character' ? character(key) : faction(key)
  const turn = session.metadata.get().turns
  try {
    session.transaction(() => {
      if (edit.kind === 'character') session.relationships.upsert(character(edit.from), character(edit.to), edit, turn)
      else if (edit.kind === 'knowledge') {
        const subject = edit.toKind === 'location' ? location(edit.to) : edit.toKind === 'item' ? (() => { const found = session.items.getBySourceId(edit.to) ?? (Number.isInteger(Number(edit.to)) ? session.items.get(Number(edit.to)) : undefined); if (found === undefined) throw new InvalidEditProblems([`there is no thing "${edit.to}"`]); return found.id })() : Number(edit.to)
        if (!Number.isInteger(subject) || (edit.toKind === 'exit' && !session.locations.allExits().some(exit => exit.id === subject))) throw new InvalidEditProblems([`there is no route "${edit.to}"`])
        session.knowledge.learn(character(edit.from), edit.toKind, subject, turn, edit.observed ?? false)
      } else if (edit.kind === 'membership') session.factionMemberships.upsert(faction(edit.to), character(edit.from), edit, turn)
      else if (edit.kind === 'social') session.factionRelationships.upsert(edit.fromKind, social(edit.fromKind, edit.from), edit.toKind, social(edit.toKind, edit.to), edit, turn)
      else session.locations.addExit({ fromId: location(edit.from), toId: location(edit.to), description: edit.description, ...(edit.travelSeconds === undefined ? {} : { travelSeconds: edit.travelSeconds }), state: edit.state ?? 'open', note: edit.note ?? '' })
    })
  } catch (error) { if (error instanceof InvalidEditProblems) throw error; if (error instanceof Error && ['InvalidValueError', 'ConflictError', 'NotFoundError'].includes(error.name)) throw new InvalidEditProblems([error.message]); throw error }
  return worldOf(session, sessionsDir)
}

function characterOf(session: Session, key: string) {
  const character = session.characters.list().find(candidate => keyOf(candidate) === key)
  if (character === undefined) throw new InvalidEditProblems([`there is no character "${key}"`])
  return character
}

/** Generate or replace a session character's stable reference portrait from its copied identity. */
export async function generateSessionCharacterPortrait(deps: WorldStateDeps, id: string, key: string, service: ImageGenerationService): Promise<WorldState> {
  const session = sessionOf(deps, id)
  const character = characterOf(session, key)
  const identity = session.visualIdentities.get('character', character.id)
  if (identity === undefined) throw new InvalidEditProblems([`${character.name} needs a visual identity before a portrait can be generated`])
  await generateReferenceImage(service, {
    root: sessionFolder(deps.sessionsDir(), id),
    subject: { kind: 'character', localId: character.sourceId ?? character.id, name: character.name, ...(identity.globalId === undefined ? {} : { globalId: identity.globalId }) },
    identity,
  })
  return worldOf(session, deps.sessionsDir())
}

/** Resolve a portrait through session state so request parameters cannot select arbitrary files. */
export async function sessionCharacterPortraitFile(deps: WorldStateDeps, id: string, key: string): Promise<{ file: string; size: number }> {
  const session = sessionOf(deps, id)
  const character = characterOf(session, key)
  const identity = session.visualIdentities.get('character', character.id)
  const file = referenceImagePath(sessionFolder(deps.sessionsDir(), id), { kind: 'character', localId: character.sourceId ?? character.id, ...(identity?.globalId === undefined ? {} : { globalId: identity.globalId }) })
  return { file, size: (await stat(file)).size }
}
