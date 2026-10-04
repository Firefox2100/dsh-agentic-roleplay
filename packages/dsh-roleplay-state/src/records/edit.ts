import type { JsonSchemaNode, ObjectJsonSchema } from '@deepseek-ai/dsh-tools'
import {
  ACCURACIES, IMPORTANCE_MAX, IMPORTANCE_MIN, MEMORY_KINDS, PERCEPTION_MODES,
  type Accuracy, type Character, type CharacterId, type CharacterStatePatch, type MemoryKind, type NewPerception, type PerceptionMode,
} from 'dsh-roleplay-model'
import { CHARACTER_KINDS, CHARACTER_TIERS, EXIT_STATES, MAX_LOCATION_FEATURES, type CharacterKind, type CharacterTier, type ExitState, type Location, type LocationFeature, type RelationshipPatch } from 'dsh-roleplay-model'
import { InvalidEditError, InvalidMoveError } from '../errors.ts'
import { moveCharacter } from './movement.ts'
import type { CharacterRepository, CharacterStateRepository, ConsolidationRepository, EventRepository, LocationRepository, MemoryRepository, PlacementRepository, RelationshipRepository, ThreadRepository } from '../repositories.ts'
import { lookupKey } from '../sqlite/support.ts'

/** The name by which models and other plugins refer to a place: its id in the world, or its number when it was made up in play. */
export const locationKey = (location: Pick<Location, 'id' | 'sourceId'>): string => location.sourceId ?? String(location.id)

/** The name by which models and other plugins refer to a character: its id in the world, or its number when it has none. */
export const characterKey = (character: Pick<Character, 'id' | 'sourceId'>): string => character.sourceId ?? String(character.id)

/** What an edit of the story's records can touch. */
export interface RecordsTarget {
  characters: CharacterRepository
  characterStates: CharacterStateRepository
  events: EventRepository
  memories: MemoryRepository
  threads: ThreadRepository
  locations: LocationRepository
  placements: PlacementRepository
  relationships: RelationshipRepository
  consolidation: ConsolidationRepository
  transaction<T>(fn: () => T): T
}

export interface PerceivedBy {
  character: string
  mode: PerceptionMode
  /** What the character took in, when it is not exactly the event. */
  content?: string
  gist?: string
  accuracy?: Accuracy
}

export interface StatePatch extends Pick<CharacterStatePatch, 'publicState' | 'innerState' | 'activity'> {
  character: string
  /** How the character feels right now; its temperament does not change. */
  emotion?: { valence: number; arousal: number; dominance: number }
}

export interface NewEvent {
  /** The key of the place it happened in. */
  location?: string
  turn: number
  round: number
  text: string
  importance: number
  tags?: string[]
  involves?: string[]
  perceivedBy?: PerceivedBy[]
}

export interface EventEdit {
  id: number
  location?: string
  text?: string
  importance?: number
  tags?: string[]
  involves?: string[]
  /** Replaces who took the event in. */
  perceivedBy?: PerceivedBy[]
}

/** A character's version of an event, revised: it learned more, or remembers it differently. Works on sealed events too. */
export interface PerceptionEdit {
  id: number
  mode?: PerceptionMode
  content?: string
  gist?: string
  accuracy?: Accuracy
}

/** One more character took in an event, possibly long after: it was told, or worked it out. Works on sealed events too. */
export interface PerceptionAddition extends PerceivedBy {
  event: number
}

export interface NewExit {
  /** The key of the place it leads to. */
  to: string
  description?: string
  /** Also make the way back, with `backDescription`; on by default. */
  oneWay?: boolean
  backDescription?: string
  travelSeconds?: number
  state?: ExitState
  note?: string
}

/** A place made up in play (or arriving with a plugin): a hidden passage, a room the story opens. */
export interface NewPlace {
  key: string
  name: string
  description?: string
  /** The key of the place it is in. */
  parent?: string
  features?: { key: string; name: string; description?: string }[]
  exits?: NewExit[]
  /** Why it was made, for whoever fits it into the world later. */
  note?: string
}

/** A character the story makes up: someone who arrives, is introduced, or turns out to be needed. Always played by an agent. */
export interface NewCharacterSpec {
  key: string
  name: string
  aliases?: string[]
  age?: string
  gender?: string
  pronouns?: string
  kind?: CharacterKind
  tier?: CharacterTier
  summary: string
  personality?: string
  background?: string
  appearance?: string
  speech?: { style: string; examples?: string[] }
  state?: { publicState?: string; innerState?: string; activity?: string }
  place?: { location: string; position?: string; feature?: string }
  /** Why it was made, for whoever fits it into the world later. */
  note?: string
}

/** A character's profile of another, made or changed; what is not given stays as it was. */
export interface RelationshipSet {
  from: string
  to: string
  label?: string
  summary?: string
  familiarity?: number
  trust?: number
  affinity?: number
  tension?: number
}

export interface RelationshipRetraction {
  from: string
  to: string
}

/** A new way between two places that already exist (or are made in the same edit). */
export interface NewExitBetween {
  from: string
  to: string
  description?: string
  /** Also make the way back, with `backDescription`; on by default. */
  oneWay?: boolean
  backDescription?: string
  travelSeconds?: number
  state?: ExitState
  note?: string
}

export interface PlaceEdit {
  place: string
  name?: string
  description?: string
  /** Replaces the list of features. */
  features?: { key: string; name: string; description?: string }[]
}

/** A door is unlocked, a passage collapses: the way between two places changes, both ways unless told otherwise. */
export interface ExitChange {
  from: string
  to: string
  state?: ExitState
  description?: string
  note?: string
  travelSeconds?: number
  oneWay?: boolean
}

export interface CharacterMove {
  character: string
  to: string
  position?: string
  feature?: string
  ignoreExits?: boolean
}

export interface NewBelief {
  character: string
  kind: MemoryKind
  text: string
  about?: string[]
  importance: number
}

export interface BeliefEdit {
  id: number
  text?: string
  about?: string[]
  importance?: number
}

/**
 * A change to the story's records, applied together or not at all: the unit in which the
 * record keeper, the model-facing tools and other plugins write what happened.
 */
export interface RecordsEdit {
  /** The turn new beliefs and threads belong to. */
  turn: number
  states?: StatePatch[]
  events?: NewEvent[]
  eventEdits?: EventEdit[]
  eventRetractions?: number[]
  perceptionEdits?: PerceptionEdit[]
  perceptionsAdded?: PerceptionAddition[]
  characters?: NewCharacterSpec[]
  places?: NewPlace[]
  exits?: NewExitBetween[]
  relationships?: RelationshipSet[]
  relationshipRetractions?: RelationshipRetraction[]
  placeEdits?: PlaceEdit[]
  exitChanges?: ExitChange[]
  moves?: CharacterMove[]
  beliefs?: NewBelief[]
  beliefEdits?: BeliefEdit[]
  beliefRetractions?: number[]
  threadsOpened?: string[]
  threadsResolved?: number[]
}

export interface EditResult {
  /** The ids of the events and beliefs the edit added, in order. */
  eventIds: number[]
  /** The keys of the characters and places the edit made up. */
  characterKeys?: string[]
  placeKeys?: string[]
  beliefIds: number[]
  /** How many rows were added, changed or removed. */
  writes: number
}

const present = (value: string | undefined): boolean => value !== undefined && value.trim() !== ''
const list = <T>(value: readonly T[] | undefined): readonly T[] => value ?? []

/**
 * Apply an edit. Every problem is found before anything is written, so a bad edit changes nothing.
 * @throws {InvalidEditError} naming each problem.
 */
function applyChanges(target: RecordsTarget, edit: RecordsEdit): EditResult {
  const characters = target.characters.list()
  const byKey = new Map(characters.map(character => [characterKey(character), character]))
  const problems: string[] = []
  const known = (): string => [...byKey.keys()].join(', ')
  const idOf = (key: string, where: string): CharacterId | undefined => {
    const found = byKey.get(key)
    if (found === undefined) problems.push(`${where}: there is no character "${key}" (the characters are: ${known()})`)
    return found?.id
  }
  const ids = (keys: readonly string[] | undefined, where: string): CharacterId[] => list(keys).flatMap(key => idOf(key, where) ?? [])
  const importance = (value: number | undefined, where: string): void => {
    if (value !== undefined && (!Number.isInteger(value) || value < IMPORTANCE_MIN || value > IMPORTANCE_MAX)) problems.push(`${where}: importance must be a whole number from ${IMPORTANCE_MIN} to ${IMPORTANCE_MAX}`)
  }
  const perceptions = (text: string, given: readonly PerceivedBy[] | undefined, where: string): NewPerception[] => {
    const seen = new Set<string>()
    return list(given).flatMap((entry, index): NewPerception[] => {
      const at = `${where}.perceived_by[${index}]`
      const characterId = idOf(entry.character, at)
      if (seen.has(entry.character)) problems.push(`${at}: ${entry.character} is listed twice`)
      seen.add(entry.character)
      if (!PERCEPTION_MODES.includes(entry.mode)) problems.push(`${at}: unknown mode "${String(entry.mode)}"`)
      if (entry.accuracy !== undefined && !ACCURACIES.includes(entry.accuracy)) problems.push(`${at}: unknown accuracy "${String(entry.accuracy)}"`)
      if (characterId === undefined) return []
      const content = present(entry.content) ? entry.content!.trim() : text
      const gist = present(entry.gist) ? entry.gist!.trim() : content.length <= 80 ? content : `${content.slice(0, 77).trimEnd()}…`
      return [{ characterId, mode: entry.mode, content, gist, accuracy: entry.accuracy ?? 'accurate' }]
    })
  }
  const tags = (given: readonly string[] | undefined): string[] => [...new Set(list(given).map(tag => tag.trim().toLowerCase()).filter(tag => tag !== ''))]

  const existingPlaces = new Map(target.locations.list().map(place => [locationKey(place), place]))
  const newPlaceKeys = new Set<string>()
  const placeKnown = (key: string, where: string): void => {
    if (!existingPlaces.has(key) && !newPlaceKeys.has(key)) problems.push(`${where}: there is no place "${key}" (list_locations shows the keys)`)
  }
  const placeKeys = new Set(list(edit.places).map(place => place.key))
  list(edit.places).forEach((place, index) => {
    const where = `places[${index}]`
    if (!present(place.key)) problems.push(`${where}: give the place a key`)
    else if (existingPlaces.has(place.key) || newPlaceKeys.has(place.key)) problems.push(`${where}: the key "${place.key}" is already used by a place`)
    if (!present(place.name)) problems.push(`${where}: give the place a name`)
    if (place.parent !== undefined) placeKnown(place.parent, `${where}.parent`)
    if (list(place.features).length > MAX_LOCATION_FEATURES) problems.push(`${where}: a place has at most ${MAX_LOCATION_FEATURES} features`)
    newPlaceKeys.add(place.key)
    for (const [at, exit] of list(place.exits).entries()) {
      if (!existingPlaces.has(exit.to) && !placeKeys.has(exit.to)) problems.push(`${where}.exits[${at}]: there is no place "${exit.to}"`)
      if (exit.to === place.key) problems.push(`${where}.exits[${at}]: an exit must lead to another place`)
      if (exit.state !== undefined && !EXIT_STATES.includes(exit.state)) problems.push(`${where}.exits[${at}]: unknown state "${String(exit.state)}"`)
    }
  })
  list(edit.placeEdits).forEach((change, index) => {
    const where = `place_edits[${index}]`
    placeKnown(change.place, where)
    if (change.name !== undefined && !present(change.name)) problems.push(`${where}: a place needs a name`)
    if (list(change.features).length > MAX_LOCATION_FEATURES) problems.push(`${where}: a place has at most ${MAX_LOCATION_FEATURES} features`)
  })
  list(edit.exitChanges).forEach((change, index) => {
    const where = `exit_changes[${index}]`
    placeKnown(change.from, `${where}.from`)
    placeKnown(change.to, `${where}.to`)
    if (change.state !== undefined && !EXIT_STATES.includes(change.state)) problems.push(`${where}: unknown state "${String(change.state)}"`)
    const from = existingPlaces.get(change.from)
    const to = existingPlaces.get(change.to)
    if (from !== undefined && to !== undefined && target.locations.getExit(from.id, to.id) === undefined) problems.push(`${where}: there is no exit from "${change.from}" to "${change.to}"`)
  })
  list(edit.moves).forEach((move, index) => {
    const where = `moves[${index}]`
    idOf(move.character, where)
    placeKnown(move.to, `${where}.to`)
  })
  list(edit.exits).forEach((wanted, index) => {
    const where = `exits[${index}]`
    placeKnown(wanted.from, `${where}.from`)
    placeKnown(wanted.to, `${where}.to`)
    if (wanted.from === wanted.to) problems.push(`${where}: an exit must lead to another place`)
    if (wanted.state !== undefined && !EXIT_STATES.includes(wanted.state)) problems.push(`${where}: unknown state "${String(wanted.state)}"`)
    const from = existingPlaces.get(wanted.from)
    const to = existingPlaces.get(wanted.to)
    if (from !== undefined && to !== undefined && target.locations.getExit(from.id, to.id) !== undefined && wanted.oneWay === true) problems.push(`${where}: there already is an exit from "${wanted.from}" to "${wanted.to}" (change it with exit_changes)`)
  })
  const RELATION_RANGES = { familiarity: [0, 1], trust: [-1, 1], affinity: [-1, 1], tension: [0, 1] } as const
  list(edit.relationships).forEach((relation, index) => {
    const where = `relationships[${index}]`
    const from = idOf(relation.from, `${where}.from`)
    const to = idOf(relation.to, `${where}.to`)
    if (relation.from === relation.to) problems.push(`${where}: a character has no relationship with itself`)
    for (const [axis, [min, max]] of Object.entries(RELATION_RANGES) as [keyof typeof RELATION_RANGES, readonly [number, number]][]) {
      const value = relation[axis]
      if (value !== undefined && (!Number.isFinite(value) || value < min || value > max)) problems.push(`${where}: ${axis} must be a number from ${min} to ${max}`)
    }
    if (relation.label !== undefined && !present(relation.label)) problems.push(`${where}: the label cannot be empty`)
    if (from !== undefined && to !== undefined && target.relationships.get(from, to) === undefined && !present(relation.label)) problems.push(`${where}: a new relationship needs a label ("${relation.from}" towards "${relation.to}")`)
  })
  list(edit.relationshipRetractions).forEach((retraction, index) => {
    const where = `relationship_retractions[${index}]`
    const from = idOf(retraction.from, `${where}.from`)
    const to = idOf(retraction.to, `${where}.to`)
    if (from !== undefined && to !== undefined && target.relationships.get(from, to) === undefined) problems.push(`${where}: "${retraction.from}" has no relationship with "${retraction.to}"`)
  })
  const placeIn = (key: string | undefined, where: string): void => { if (key !== undefined) placeKnown(key, where) }
  list(edit.events).forEach((event, index) => { placeIn(event.location, `events[${index}].location`) })
  list(edit.eventEdits).forEach((change, index) => { placeIn(change.location, `event_edits[${index}].location`) })

  if (!Number.isInteger(edit.turn) || edit.turn < 1) problems.push('turn must be a whole number from 1')

  const states = list(edit.states).flatMap((patch, index) => {
    const where = `states[${index}]`
    const id = idOf(patch.character, where)
    const { emotion } = patch
    if (emotion !== undefined && [emotion.valence, emotion.arousal, emotion.dominance].some(axis => !Number.isFinite(axis) || axis < -1 || axis > 1)) problems.push(`${where}: each emotion axis must be a number from -1 to 1`)
    if (!present(patch.publicState) && !present(patch.innerState) && !present(patch.activity) && emotion === undefined) problems.push(`${where}: nothing to change`)
    return id === undefined ? [] : [{ id, patch }]
  })

  const events = list(edit.events).flatMap((event, index) => {
    const where = `events[${index}]`
    if (!present(event.text)) problems.push(`${where}: say what happened`)
    if (!Number.isInteger(event.turn) || event.turn < 1 || !Number.isInteger(event.round) || event.round < 1) problems.push(`${where}: turn and round must be whole numbers from 1`)
    importance(event.importance, where)
    return [{ event, involves: ids(event.involves, `${where}.involves`), perceived: perceptions(event.text.trim(), event.perceivedBy, where) }]
  })

  const eventEdits = list(edit.eventEdits).map((change, index) => {
    const where = `event_edits[${index}]`
    const current = target.events.get(change.id)
    if (current === undefined) problems.push(`${where}: there is no event ${change.id}`)
    else if (current.sealed) problems.push(`${where}: event ${change.id} is sealed and cannot change; what a character took in of it can be revised with perception_edits, and later knowledge added with perceptions_added`)
    if (change.text !== undefined && !present(change.text)) problems.push(`${where}: say what happened`)
    importance(change.importance, where)
    return { change, current, involves: change.involves === undefined ? undefined : ids(change.involves, `${where}.involves`), perceived: change.perceivedBy === undefined ? undefined : perceptions((change.text ?? current?.text ?? '').trim(), change.perceivedBy, where) }
  })
  for (const id of list(edit.eventRetractions)) {
    const current = target.events.get(id)
    if (current === undefined) problems.push(`event_retractions: there is no event ${id}`)
    else if (current.sealed) problems.push(`event_retractions: event ${id} is sealed and cannot be removed`)
  }

  const perceptionEdits = list(edit.perceptionEdits).map((change, index) => {
    const where = `perception_edits[${index}]`
    const current = target.events.getPerception(change.id)
    if (current === undefined) problems.push(`${where}: there is no perception ${change.id}`)
    if (change.mode !== undefined && !PERCEPTION_MODES.includes(change.mode)) problems.push(`${where}: unknown mode "${String(change.mode)}"`)
    if (change.accuracy !== undefined && !ACCURACIES.includes(change.accuracy)) problems.push(`${where}: unknown accuracy "${String(change.accuracy)}"`)
    if (change.content !== undefined && !present(change.content)) problems.push(`${where}: content cannot be empty`)
    return change
  })
  const perceptionsAdded = list(edit.perceptionsAdded).flatMap((added, index) => {
    const where = `perceptions_added[${index}]`
    const event = target.events.get(added.event)
    if (event === undefined) { problems.push(`${where}: there is no event ${added.event}`); return [] }
    const [one] = perceptions(event.text, [added], where)
    const characterId = byKey.get(added.character)?.id
    if (characterId !== undefined && target.events.perceptionsOf(added.event).some(entry => entry.characterId === characterId)) problems.push(`${where}: ${added.character} already has a perception of event ${added.event}: revise it with perception_edits`)
    return one === undefined ? [] : [{ eventId: added.event, perception: one }]
  })

  const beliefs = list(edit.beliefs).flatMap((belief, index) => {
    const where = `beliefs[${index}]`
    const character = idOf(belief.character, where)
    if (!MEMORY_KINDS.includes(belief.kind)) problems.push(`${where}: unknown kind "${String(belief.kind)}"`)
    if (!present(belief.text)) problems.push(`${where}: say what the character believes or knows`)
    importance(belief.importance, where)
    return character === undefined ? [] : [{ belief, character, about: ids(belief.about, `${where}.about`) }]
  })
  const beliefEdits = list(edit.beliefEdits).map((change, index) => {
    const where = `belief_edits[${index}]`
    if (target.memories.get(change.id) === undefined) problems.push(`${where}: there is no belief ${change.id}`)
    if (change.text !== undefined && !present(change.text)) problems.push(`${where}: say what the character believes or knows`)
    importance(change.importance, where)
    return { change, about: change.about === undefined ? undefined : ids(change.about, `${where}.about`) }
  })
  for (const id of list(edit.beliefRetractions)) if (target.memories.get(id) === undefined) problems.push(`belief_retractions: there is no belief ${id}`)
  for (const [index, text] of list(edit.threadsOpened).entries()) if (!present(text)) problems.push(`threads_opened[${index}]: say what is unsettled`)
  for (const id of list(edit.threadsResolved)) if (target.threads.get(id) === undefined) problems.push(`threads_resolved: there is no thread ${id}`)

  if (problems.length > 0) throw new InvalidEditError(problems)

  return target.transaction(() => {
    const result: EditResult = { eventIds: [], beliefIds: [], writes: 0 }
    const placeOf = (key: string): Location => {
      const found = target.locations.getBySourceId(key) ?? (Number.isInteger(Number(key)) ? target.locations.get(Number(key)) : undefined)
      if (found === undefined) throw new InvalidEditError([`there is no place "${key}"`])
      return found
    }
    const features = (given: readonly { key: string; name: string; description?: string }[] | undefined): LocationFeature[] => list(given).map(feature => ({ key: feature.key, name: feature.name, description: feature.description ?? '' }))
    const exit = (from: Location, to: Location, description: string | undefined, rest: Pick<NewExit, 'travelSeconds' | 'state' | 'note'>): void => {
      if (target.locations.getExit(from.id, to.id) !== undefined) return
      target.locations.addExit({ fromId: from.id, toId: to.id, description: description ?? '', ...(rest.travelSeconds === undefined ? {} : { travelSeconds: rest.travelSeconds }), ...(rest.state === undefined ? {} : { state: rest.state }), ...(rest.note === undefined ? {} : { note: rest.note }) })
      result.writes += 1
    }
    result.placeKeys = []
    for (const place of list(edit.places)) {
      const added = target.locations.add({ sourceId: place.key, name: place.name, description: place.description ?? '', ...(place.parent === undefined ? {} : { parentId: placeOf(place.parent).id }), features: features(place.features) })
      target.consolidation.enqueue({ kind: 'location', subjectId: added.id, note: place.note ?? 'made up in play', turn: edit.turn })
      result.placeKeys.push(place.key)
      result.writes += 1
    }
    for (const place of list(edit.places)) {
      const from = placeOf(place.key)
      for (const wanted of list(place.exits)) {
        const to = placeOf(wanted.to)
        exit(from, to, wanted.description, wanted)
        if (wanted.oneWay !== true) exit(to, from, wanted.backDescription ?? wanted.description, wanted)
      }
    }
    for (const wanted of list(edit.exits)) {
      const from = placeOf(wanted.from)
      const to = placeOf(wanted.to)
      exit(from, to, wanted.description, wanted)
      if (wanted.oneWay !== true) exit(to, from, wanted.backDescription ?? wanted.description, wanted)
    }
    for (const relation of list(edit.relationships)) {
      const { from, to, ...fields } = relation
      const patch: RelationshipPatch = {
        ...(fields.label === undefined ? {} : { label: fields.label }), ...(fields.summary === undefined ? {} : { summary: fields.summary }),
        ...(fields.familiarity === undefined ? {} : { familiarity: fields.familiarity }), ...(fields.trust === undefined ? {} : { trust: fields.trust }),
        ...(fields.affinity === undefined ? {} : { affinity: fields.affinity }), ...(fields.tension === undefined ? {} : { tension: fields.tension }),
      }
      target.relationships.upsert(byKey.get(from)!.id, byKey.get(to)!.id, patch, edit.turn)
      result.writes += 1
    }
    for (const retraction of list(edit.relationshipRetractions)) {
      target.relationships.remove(byKey.get(retraction.from)!.id, byKey.get(retraction.to)!.id)
      result.writes += 1
    }
    for (const change of list(edit.placeEdits)) {
      target.locations.update(placeOf(change.place).id, {
        ...(change.name === undefined ? {} : { name: change.name }),
        ...(change.description === undefined ? {} : { description: change.description }),
        ...(change.features === undefined ? {} : { features: features(change.features) }),
      })
      result.writes += 1
    }
    for (const change of list(edit.exitChanges)) {
      const from = placeOf(change.from)
      const to = placeOf(change.to)
      const sides = change.oneWay === true ? [[from, to]] as const : [[from, to], [to, from]] as const
      let found = false
      for (const [a, b] of sides) {
        const current = target.locations.getExit(a.id, b.id)
        if (current === undefined) continue
        found = true
        target.locations.updateExit(current.id, {
          ...(change.state === undefined ? {} : { state: change.state }),
          ...(change.description === undefined || a !== from ? {} : { description: change.description }),
          ...(change.note === undefined ? {} : { note: change.note }),
          ...(change.travelSeconds === undefined ? {} : { travelSeconds: change.travelSeconds }),
        })
        result.writes += 1
      }
      if (!found) throw new InvalidEditError([`there is no exit from "${change.from}" to "${change.to}"`])
    }
    for (const [index, move] of list(edit.moves).entries()) {
      const character = byKey.get(move.character)!
      try {
        moveCharacter(target, character.id, { to: placeOf(move.to).id, ...(move.position === undefined ? {} : { position: move.position }), ...(move.feature === undefined ? {} : { featureKey: move.feature }), ...(move.ignoreExits === true ? { ignoreExits: true } : {}) })
      } catch (error) {
        if (error instanceof InvalidMoveError) throw new InvalidEditError(error.problems.map(problem => `moves[${index}]: ${problem}`))
        throw error
      }
      result.writes += 1
    }
    for (const { id, patch } of states) {
      const current = target.characterStates.get(id)
      const { character: _character, emotion, ...fields } = patch
      const written: CharacterStatePatch = {
        ...(present(fields.publicState) ? { publicState: fields.publicState!.trim() } : {}),
        ...(present(fields.innerState) ? { innerState: fields.innerState!.trim() } : {}),
        ...(present(fields.activity) ? { activity: fields.activity!.trim() } : {}),
        ...(emotion === undefined ? {} : { emotion: { baseline: current?.emotion?.baseline ?? emotion, immediate: emotion } }),
      }
      if (current === undefined) {
        target.characterStates.create(id, { publicState: written.publicState ?? '', innerState: written.innerState ?? '', activity: written.activity ?? '', ...(emotion === undefined ? {} : { emotion: { baseline: emotion, immediate: emotion } }) })
      } else {
        target.characterStates.update(id, written)
      }
      result.writes += 1
    }
    for (const { event, involves, perceived } of events) {
      const { event: stored } = target.events.add({ turn: event.turn, round: event.round, text: event.text.trim(), importance: event.importance, tags: tags(event.tags), involves, ...(event.location === undefined ? {} : { locationId: placeOf(event.location).id }) }, perceived)
      result.eventIds.push(stored.id)
      result.writes += 1
    }
    for (const { change, involves, perceived } of eventEdits) {
      target.events.update(change.id, {
        ...(change.text === undefined ? {} : { text: change.text.trim() }),
        ...(change.importance === undefined ? {} : { importance: change.importance }),
        ...(change.tags === undefined ? {} : { tags: tags(change.tags) }),
        ...(involves === undefined ? {} : { involves }),
        ...(change.location === undefined ? {} : { locationId: placeOf(change.location).id }),
      })
      if (perceived !== undefined) target.events.setPerceptions(change.id, perceived)
      result.writes += 1
    }
    for (const id of list(edit.eventRetractions)) { target.events.remove(id); result.writes += 1 }
    for (const change of perceptionEdits) {
      target.events.updatePerception(change.id, {
        ...(change.mode === undefined ? {} : { mode: change.mode }),
        ...(change.content === undefined ? {} : { content: change.content.trim() }),
        ...(change.gist === undefined ? {} : { gist: change.gist.trim() }),
        ...(change.accuracy === undefined ? {} : { accuracy: change.accuracy }),
      })
      result.writes += 1
    }
    for (const { eventId, perception } of perceptionsAdded) { target.events.addPerception(eventId, perception); result.writes += 1 }
    for (const { belief, character, about } of beliefs) {
      result.beliefIds.push(target.memories.add({ characterId: character, kind: belief.kind, text: belief.text.trim(), about, importance: belief.importance, turn: edit.turn }).id)
      result.writes += 1
    }
    for (const { change, about } of beliefEdits) {
      target.memories.update(change.id, {
        ...(change.text === undefined ? {} : { text: change.text.trim() }),
        ...(about === undefined ? {} : { about }),
        ...(change.importance === undefined ? {} : { importance: change.importance }),
      })
      result.writes += 1
    }
    for (const id of list(edit.beliefRetractions)) { target.memories.remove(id); result.writes += 1 }
    for (const text of list(edit.threadsOpened)) { target.threads.open(text.trim(), edit.turn); result.writes += 1 }
    for (const id of list(edit.threadsResolved)) { target.threads.resolve(id, edit.turn); result.writes += 1 }
    return result
  })
}

/**
 * Make up the characters of an edit: validated first, then written with their state and place, and each
 * one is queued to be fitted into the rest of the world. Nothing is written when anything is wrong.
 */
function createCharacters(target: RecordsTarget, edit: RecordsEdit): { keys: string[]; writes: number } {
  const problems: string[] = []
  const taken = new Set(target.characters.list().flatMap(character => [lookupKey(character.name), ...character.aliases.map(lookupKey)]))
  const keys = new Set(target.characters.list().map(characterKey))
  const placeFor = (key: string): Location | undefined => target.locations.getBySourceId(key) ?? (Number.isInteger(Number(key)) ? target.locations.get(Number(key)) : undefined)
  const wanted = list(edit.characters)
  wanted.forEach((spec, index) => {
    const where = `characters[${index}]`
    if (!present(spec.key) || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,59}$/.test(spec.key)) problems.push(`${where}: give the character a key of letters, digits, "-" or "_"`)
    else if (keys.has(spec.key)) problems.push(`${where}: the key "${spec.key}" is already used by a character`)
    keys.add(spec.key)
    if (!present(spec.name)) problems.push(`${where}: give the character a name`)
    if (!present(spec.summary)) problems.push(`${where}: give the character a summary of a sentence or two`)
    for (const name of [spec.name, ...list(spec.aliases)]) {
      const found = lookupKey(name ?? '')
      if (found === '') continue
      if (taken.has(found)) problems.push(`${where}: "${name}" is already the name of a character: reuse that one instead of making another`)
      taken.add(found)
    }
    if (spec.kind !== undefined && !CHARACTER_KINDS.includes(spec.kind)) problems.push(`${where}: unknown kind "${String(spec.kind)}"`)
    if (spec.tier !== undefined && !CHARACTER_TIERS.includes(spec.tier)) problems.push(`${where}: unknown tier "${String(spec.tier)}"`)
    if (spec.place !== undefined) {
      const place = placeFor(spec.place.location)
      if (place === undefined) problems.push(`${where}.place: there is no place "${spec.place.location}" (list_locations shows the keys)`)
      else if (spec.place.feature !== undefined && !place.features.some(feature => feature.key === spec.place!.feature)) problems.push(`${where}.place: ${place.name} has no feature "${spec.place.feature}"`)
    }
  })
  if (problems.length > 0) throw new InvalidEditError(problems)
  for (const spec of wanted) {
    const character = target.characters.add({
      sourceId: spec.key, name: spec.name.trim(), aliases: list(spec.aliases).map(alias => alias.trim()).filter(alias => alias !== '' && lookupKey(alias) !== lookupKey(spec.name)),
      ...(spec.age === undefined ? {} : { age: spec.age }), ...(spec.gender === undefined ? {} : { gender: spec.gender }), ...(spec.pronouns === undefined ? {} : { pronouns: spec.pronouns }),
      kind: spec.kind ?? 'person', tier: spec.tier ?? 'supporting', role: 'npc', control: 'agent',
      summary: spec.summary.trim(), personality: (spec.personality ?? '').trim(), background: (spec.background ?? '').trim(), appearance: (spec.appearance ?? '').trim(),
      speech: { style: (spec.speech?.style ?? '').trim(), examples: list(spec.speech?.examples) as string[] },
    })
    target.characterStates.create(character.id, { publicState: (spec.state?.publicState ?? '').trim(), innerState: (spec.state?.innerState ?? '').trim(), activity: (spec.state?.activity ?? '').trim() })
    if (spec.place !== undefined) {
      target.placements.place('character', character.id, { locationId: placeFor(spec.place.location)!.id, ...(spec.place.position === undefined ? {} : { position: spec.place.position }), ...(spec.place.feature === undefined ? {} : { featureKey: spec.place.feature }) })
    }
    target.consolidation.enqueue({ kind: 'character', subjectId: character.id, note: spec.note ?? 'made up in play', turn: edit.turn })
  }
  return { keys: wanted.map(spec => spec.key), writes: wanted.length }
}

/**
 * Apply an edit. Every problem is found before anything is written, so a bad edit changes nothing.
 * Characters made up by the edit are created after its places and before everything else, so that the rest
 * of the edit (relationships, events, moves) can name them; the whole is still one transaction.
 * @throws {InvalidEditError} naming each problem.
 */
export function applyRecordsEdit(target: RecordsTarget, edit: RecordsEdit): EditResult {
  if (list(edit.characters).length === 0) return applyChanges(target, edit)
  return target.transaction(() => {
    const placesFirst = applyChanges(target, { turn: edit.turn, places: list(edit.places) as NewPlace[] })
    const made = createCharacters(target, edit)
    const rest = applyChanges(target, { ...edit, places: [], characters: [] })
    return {
      eventIds: rest.eventIds, beliefIds: rest.beliefIds, writes: placesFirst.writes + made.writes + rest.writes,
      characterKeys: made.keys, placeKeys: placesFirst.placeKeys ?? [],
    }
  })
}

type Wire = Record<string, unknown>
const isObject = (value: unknown): value is Wire => typeof value === 'object' && value !== null && !Array.isArray(value)

/**
 * Read an edit from the JSON models write (snake_case), the one wire format of the
 * keeper's output and of the write tools.
 * @throws {InvalidEditError} when it is not shaped as an edit.
 */
export function parseRecordsEdit(value: unknown): RecordsEdit {
  const problems: string[] = []
  if (!isObject(value)) throw new InvalidEditError(['the edit must be an object'])
  const array = (key: string): Wire[] => {
    const entries = value[key]
    if (entries === undefined || entries === null) return []
    if (!Array.isArray(entries)) { problems.push(`${key} must be a list`); return [] }
    return entries.flatMap((entry, index) => {
      if (isObject(entry)) return [entry]
      problems.push(`${key}[${index}] must be an object`)
      return []
    })
  }
  const numbers = (key: string): number[] => {
    const entries = value[key]
    if (entries === undefined || entries === null) return []
    if (!Array.isArray(entries) || entries.some(entry => typeof entry !== 'number')) { problems.push(`${key} must be a list of numbers`); return [] }
    return entries as number[]
  }
  const strings = (entry: Wire, key: string): string[] | undefined => {
    const found = entry[key]
    if (found === undefined || found === null) return undefined
    if (!Array.isArray(found) || found.some(item => typeof item !== 'string')) { problems.push(`${key} must be a list of text`); return undefined }
    return found as string[]
  }
  const text = (entry: Wire, key: string): string | undefined => (typeof entry[key] === 'string' ? entry[key] : undefined)
  const num = (entry: Wire, key: string): number | undefined => (typeof entry[key] === 'number' ? entry[key] : undefined)
  const perceived = (entry: Wire): PerceivedBy[] | undefined => {
    const found = entry['perceived_by']
    if (found === undefined || found === null) return undefined
    if (!Array.isArray(found)) { problems.push('perceived_by must be a list'); return undefined }
    return found.filter(isObject).map(item => ({
      character: text(item, 'character') ?? '', mode: (text(item, 'mode') ?? '') as PerceptionMode,
      ...(text(item, 'content') === undefined ? {} : { content: text(item, 'content')! }),
      ...(text(item, 'gist') === undefined ? {} : { gist: text(item, 'gist')! }),
      ...(text(item, 'accuracy') === undefined ? {} : { accuracy: text(item, 'accuracy') as Accuracy }),
    }))
  }
  const bool = (entry: Wire, key: string): boolean | undefined => (typeof entry[key] === 'boolean' ? entry[key] : undefined)
  const featuresOf = (entry: Wire): { key: string; name: string; description?: string }[] | undefined => {
    const found = entry['features']
    if (found === undefined || found === null) return undefined
    if (!Array.isArray(found)) { problems.push('features must be a list'); return undefined }
    return found.filter(isObject).map(item => ({ key: text(item, 'key') ?? '', name: text(item, 'name') ?? '', ...(text(item, 'description') === undefined ? {} : { description: text(item, 'description')! }) }))
  }
  const defined = <T>(entry: object): T => Object.fromEntries(Object.entries(entry).filter(([, field]) => field !== undefined)) as T

  const turn = num(value, 'turn')
  const edit: RecordsEdit = {
    turn: turn ?? 0,
    states: array('states').map((entry): StatePatch => defined<StatePatch>({
      character: text(entry, 'character') ?? '', publicState: text(entry, 'public_state'), innerState: text(entry, 'inner_state'), activity: text(entry, 'activity'),
      emotion: isObject(entry['emotion']) ? { valence: num(entry['emotion'], 'valence') ?? Number.NaN, arousal: num(entry['emotion'], 'arousal') ?? Number.NaN, dominance: num(entry['emotion'], 'dominance') ?? Number.NaN } : undefined,
    })),
    events: array('events').map((entry): NewEvent => defined<NewEvent>({
      turn: num(entry, 'turn') ?? 0, round: num(entry, 'round') ?? 0, text: text(entry, 'text') ?? '', importance: num(entry, 'importance') ?? 0,
      tags: strings(entry, 'tags'), involves: strings(entry, 'involves'), perceivedBy: perceived(entry), location: text(entry, 'location'),
    })),
    eventEdits: array('event_edits').map((entry): EventEdit => defined<EventEdit>({
      id: num(entry, 'id') ?? 0, text: text(entry, 'text'), importance: num(entry, 'importance'), tags: strings(entry, 'tags'), involves: strings(entry, 'involves'), perceivedBy: perceived(entry), location: text(entry, 'location'),
    })),
    eventRetractions: numbers('event_retractions'),
    perceptionEdits: array('perception_edits').map((entry): PerceptionEdit => defined<PerceptionEdit>({
      id: num(entry, 'id') ?? 0, mode: text(entry, 'mode') as PerceptionMode | undefined, content: text(entry, 'content'), gist: text(entry, 'gist'), accuracy: text(entry, 'accuracy') as Accuracy | undefined,
    })),
    perceptionsAdded: array('perceptions_added').map((entry): PerceptionAddition => defined<PerceptionAddition>({
      event: num(entry, 'event') ?? 0, character: text(entry, 'character') ?? '', mode: (text(entry, 'mode') ?? '') as PerceptionMode,
      content: text(entry, 'content'), gist: text(entry, 'gist'), accuracy: text(entry, 'accuracy') as Accuracy | undefined,
    })),
    characters: array('characters').map((entry): NewCharacterSpec => defined<NewCharacterSpec>({
      key: text(entry, 'key') ?? '', name: text(entry, 'name') ?? '', aliases: strings(entry, 'aliases'), age: text(entry, 'age'), gender: text(entry, 'gender'), pronouns: text(entry, 'pronouns'),
      kind: text(entry, 'kind') as CharacterKind | undefined, tier: text(entry, 'tier') as CharacterTier | undefined, summary: text(entry, 'summary') ?? '',
      personality: text(entry, 'personality'), background: text(entry, 'background'), appearance: text(entry, 'appearance'), note: text(entry, 'note'),
      speech: isObject(entry['speech']) ? defined<NonNullable<NewCharacterSpec['speech']>>({ style: text(entry['speech'], 'style') ?? '', examples: strings(entry['speech'], 'examples') }) : undefined,
      state: isObject(entry['state']) ? defined<NonNullable<NewCharacterSpec['state']>>({ publicState: text(entry['state'], 'public_state'), innerState: text(entry['state'], 'inner_state'), activity: text(entry['state'], 'activity') }) : undefined,
      place: isObject(entry['place']) ? defined<NonNullable<NewCharacterSpec['place']>>({ location: text(entry['place'], 'location') ?? '', position: text(entry['place'], 'position'), feature: text(entry['place'], 'feature') }) : undefined,
    })),
    places: array('places').map((entry): NewPlace => defined<NewPlace>({
      key: text(entry, 'key') ?? '', name: text(entry, 'name') ?? '', description: text(entry, 'description'), parent: text(entry, 'parent'), features: featuresOf(entry), note: text(entry, 'note'),
      exits: Array.isArray(entry['exits']) ? entry['exits'].filter(isObject).map((item): NewExit => defined<NewExit>({
        to: text(item, 'to') ?? '', description: text(item, 'description'), oneWay: bool(item, 'one_way'), backDescription: text(item, 'back_description'),
        travelSeconds: num(item, 'travel_time_seconds'), state: text(item, 'state') as ExitState | undefined, note: text(item, 'note'),
      })) : undefined,
    })),
    exits: array('exits').map((entry): NewExitBetween => defined<NewExitBetween>({
      from: text(entry, 'from') ?? '', to: text(entry, 'to') ?? '', description: text(entry, 'description'), oneWay: bool(entry, 'one_way'), backDescription: text(entry, 'back_description'),
      travelSeconds: num(entry, 'travel_time_seconds'), state: text(entry, 'state') as ExitState | undefined, note: text(entry, 'note'),
    })),
    relationships: array('relationships').map((entry): RelationshipSet => defined<RelationshipSet>({
      from: text(entry, 'from') ?? '', to: text(entry, 'to') ?? '', label: text(entry, 'label'), summary: text(entry, 'summary'),
      familiarity: num(entry, 'familiarity'), trust: num(entry, 'trust'), affinity: num(entry, 'affinity'), tension: num(entry, 'tension'),
    })),
    relationshipRetractions: array('relationship_retractions').map((entry): RelationshipRetraction => ({ from: text(entry, 'from') ?? '', to: text(entry, 'to') ?? '' })),
    placeEdits: array('place_edits').map((entry): PlaceEdit => defined<PlaceEdit>({ place: text(entry, 'place') ?? '', name: text(entry, 'name'), description: text(entry, 'description'), features: featuresOf(entry) })),
    exitChanges: array('exit_changes').map((entry): ExitChange => defined<ExitChange>({
      from: text(entry, 'from') ?? '', to: text(entry, 'to') ?? '', state: text(entry, 'state') as ExitState | undefined, description: text(entry, 'description'), note: text(entry, 'note'),
      travelSeconds: num(entry, 'travel_time_seconds'), oneWay: bool(entry, 'one_way'),
    })),
    moves: array('moves').map((entry): CharacterMove => defined<CharacterMove>({
      character: text(entry, 'character') ?? '', to: text(entry, 'to') ?? '', position: text(entry, 'position'), feature: text(entry, 'feature'), ignoreExits: bool(entry, 'ignore_exits'),
    })),
    beliefs: array('beliefs').map((entry): NewBelief => defined<NewBelief>({
      character: text(entry, 'character') ?? '', kind: (text(entry, 'kind') ?? '') as MemoryKind, text: text(entry, 'text') ?? '', about: strings(entry, 'about'), importance: num(entry, 'importance') ?? 0,
    })),
    beliefEdits: array('belief_edits').map((entry): BeliefEdit => defined<BeliefEdit>({ id: num(entry, 'id') ?? 0, text: text(entry, 'text'), about: strings(entry, 'about'), importance: num(entry, 'importance') })),
    beliefRetractions: numbers('belief_retractions'),
    threadsOpened: Array.isArray(value['threads_opened']) ? (value['threads_opened'] as unknown[]).filter((entry): entry is string => typeof entry === 'string') : [],
    threadsResolved: numbers('threads_resolved'),
  }
  if (problems.length > 0) throw new InvalidEditError(problems)
  return edit
}

const IMPORTANCE: JsonSchemaNode = { type: 'integer', enum: [1, 2, 3, 4, 5], description: `From ${IMPORTANCE_MIN} (a passing detail) to ${IMPORTANCE_MAX} (turns the story).` }

/**
 * The JSON schema of the wire format, for a model's structured output or a tool's parameters.
 * With `characters`, a character can only be named by one of those keys.
 */
export function recordsEditSchema(options: { characters?: readonly string[]; changes?: boolean; /** Offer the making of characters, places and ways: only for the agent whose work that is. */ authoring?: boolean } = {}): ObjectJsonSchema {
  const character: JsonSchemaNode = options.characters === undefined || options.characters.length === 0
    ? { type: 'string', description: 'The key of a character.' }
    : { type: 'string', enum: [...options.characters], description: 'The key of a character.' }
  const keys: JsonSchemaNode = { type: 'array', items: character }
  const perceivedBy: JsonSchemaNode = {
    type: 'array',
    description: 'Who took the event in: only characters who could actually have perceived it. A character always perceives what it does or says itself.',
    items: {
      type: 'object',
      properties: {
        character,
        mode: { type: 'string', enum: [...PERCEPTION_MODES], description: 'How: saw it, heard it, was told, or worked it out.' },
        content: { type: 'string', description: 'What this character took in, in its own terms. Leave out when it took in exactly the event.' },
        gist: { type: 'string', description: 'The essence of it in a few words.' },
        accuracy: { type: 'string', enum: [...ACCURACIES], description: 'How well that matches what happened. Never shown to the character. Defaults to accurate.' },
      },
      required: ['character', 'mode'],
      additionalProperties: false,
    },
  }
  const placeKey: JsonSchemaNode = { type: 'string', description: 'The key of a place, as list_locations gives it, or one of the places made in this same edit.' }
  const featureList: JsonSchemaNode = {
    type: 'array',
    description: 'Named things in the place that a story can point at: a desk, a window, a notice board.',
    items: { type: 'object', properties: { key: { type: 'string' }, name: { type: 'string' }, description: { type: 'string' } }, required: ['key', 'name'], additionalProperties: false },
  }
  const properties: ObjectJsonSchema['properties'] = {
    turn: { type: 'integer', description: 'The turn these records belong to.' },
    states: {
      type: 'array',
      description: 'The new state of the characters whose state changed. Give only the fields that changed.',
      items: {
        type: 'object',
        properties: {
          character,
          public_state: { type: 'string', description: 'What anyone present can now see of the character: a short present-tense description, never a log of events.' },
          inner_state: { type: 'string', description: 'What the character now thinks and feels; private.' },
          activity: { type: 'string', description: 'What the character is concretely doing now.' },
          emotion: {
            type: 'object',
            description: 'How the character feels right now, each axis from -1 to 1.',
            properties: { valence: { type: 'number' }, arousal: { type: 'number' }, dominance: { type: 'number' } },
            required: ['valence', 'arousal', 'dominance'],
            additionalProperties: false,
          },
        },
        required: ['character'],
        additionalProperties: false,
      },
    },
    events: {
      type: 'array',
      description: 'What objectively happened: short, factual, past-tense statements.',
      items: {
        type: 'object',
        properties: {
          turn: { type: 'integer' },
          round: { type: 'integer' },
          text: { type: 'string' },
          importance: IMPORTANCE,
          tags: { type: 'array', items: { type: 'string' }, description: 'Lowercase words a later search could use: objects, places, topics.' },
          involves: { ...keys, description: 'The characters the event is about: who acted and who it was done to.' },
          perceived_by: perceivedBy,
          location: { ...placeKey, description: 'Where it happened: the key of the place.' },
        },
        required: ['turn', 'round', 'text', 'importance', 'tags', 'involves', 'perceived_by'],
        additionalProperties: false,
      },
    },
    beliefs: {
      type: 'array',
      description: 'What a character has come to believe or know beyond a single event, from its own point of view.',
      items: {
        type: 'object',
        properties: {
          character,
          kind: { type: 'string', enum: [...MEMORY_KINDS] },
          text: { type: 'string' },
          about: keys,
          importance: IMPORTANCE,
        },
        required: ['character', 'kind', 'text', 'importance'],
        additionalProperties: false,
      },
    },
    relationships: {
      type: 'array',
      description: 'How a character stands towards another: a small profile, one per direction. Give only what changed; a new one needs a label. Record a change when something happened that really changes it, not for every pleasantry.',
      items: {
        type: 'object',
        properties: {
          from: character,
          to: character,
          label: { type: 'string', description: 'What the other is to this character, in a word or two: sister, rival, landlord.' },
          summary: { type: 'string', description: 'The relationship in a sentence or two: how it came about, what it is like now.' },
          familiarity: { type: 'number', description: 'How well it knows the other: 0 a stranger, 1 intimately.' },
          trust: { type: 'number', description: 'From -1 (distrusts) to 1 (trusts completely).' },
          affinity: { type: 'number', description: 'From -1 (dislikes) to 1 (is fond of).' },
          tension: { type: 'number', description: 'How strained it is now: 0 none, 1 about to break.' },
        },
        required: ['from', 'to'],
        additionalProperties: false,
      },
    },
    relationship_retractions: {
      type: 'array',
      description: 'Profiles that no longer describe anything: the two never actually met, or it was made by mistake.',
      items: { type: 'object', properties: { from: character, to: character }, required: ['from', 'to'], additionalProperties: false },
    },
    place_edits: {
      type: 'array',
      description: 'Changes to a known place: it burned down, a feature appeared. Give only what changes; features replaces the list.',
      items: { type: 'object', properties: { place: placeKey, name: { type: 'string' }, description: { type: 'string' }, features: featureList }, required: ['place'], additionalProperties: false },
    },
    exit_changes: {
      type: 'array',
      description: 'The way between two places changed: a door unlocked, a passage collapsed. Applies to both directions unless one_way.',
      items: {
        type: 'object',
        properties: { from: placeKey, to: placeKey, state: { type: 'string', enum: [...EXIT_STATES] }, description: { type: 'string' }, note: { type: 'string' }, travel_time_seconds: { type: 'integer' }, one_way: { type: 'boolean' } },
        required: ['from', 'to'],
        additionalProperties: false,
      },
    },
    moves: {
      type: 'array',
      description: 'Where characters go. Not for what the game master already decided; those moves are written already.',
      items: {
        type: 'object',
        properties: { character, to: placeKey, position: { type: 'string' }, feature: { type: 'string' }, ignore_exits: { type: 'boolean' } },
        required: ['character', 'to'],
        additionalProperties: false,
      },
    },
    threads_opened: { type: 'array', items: { type: 'string' }, description: 'Promises made, mysteries raised, goals set that are not settled yet: one sentence each.' },
    threads_resolved: { type: 'array', items: { type: 'integer' }, description: 'The ids of open threads that are now settled.' },
  }
  if (options.authoring === true) {
    Object.assign(properties, {
      places: {
        type: 'array',
        description: 'Places the story makes up or opens: a hidden passage, a room that was behind a door. Only for places that are not already known.',
        items: {
          type: 'object',
          properties: {
            key: { type: 'string', description: 'A short lowercase key that does not exist yet.' },
            name: { type: 'string' },
            description: { type: 'string' },
            parent: placeKey,
            features: featureList,
            exits: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  to: placeKey,
                  description: { type: 'string', description: 'What the way looks like from this place.' },
                  one_way: { type: 'boolean', description: 'Leave out for a way that works both ways.' },
                  back_description: { type: 'string' },
                  travel_time_seconds: { type: 'integer' },
                  state: { type: 'string', enum: [...EXIT_STATES] },
                  note: { type: 'string' },
                },
                required: ['to'],
                additionalProperties: false,
              },
            },
            note: { type: 'string', description: 'Why it was made, for whoever fits it into the world later.' },
          },
          required: ['key', 'name'],
          additionalProperties: false,
        },
      },
      exits: {
        type: 'array',
        description: 'New ways between places that exist (or are made in this edit). Both directions unless one_way.',
        items: {
          type: 'object',
          properties: { from: placeKey, to: placeKey, description: { type: 'string' }, one_way: { type: 'boolean' }, back_description: { type: 'string' }, travel_time_seconds: { type: 'integer' }, state: { type: 'string', enum: [...EXIT_STATES] }, note: { type: 'string' } },
          required: ['from', 'to'],
          additionalProperties: false,
        },
      },
      characters: {
        type: 'array',
        description: 'People the story makes up, only when it genuinely needs them. Played by an agent from what is given here.',
        items: {
          type: 'object',
          properties: {
            key: { type: 'string', description: 'A short lowercase key that does not exist yet.' },
            name: { type: 'string' },
            aliases: { type: 'array', items: { type: 'string' } },
            age: { type: 'string' },
            gender: { type: 'string' },
            pronouns: { type: 'string' },
            kind: { type: 'string', enum: [...CHARACTER_KINDS], description: 'person, or group for a crowd or organisation treated as one.' },
            tier: { type: 'string', enum: [...CHARACTER_TIERS], description: 'supporting by default; background for someone who only reacts.' },
            summary: { type: 'string', description: 'One or two sentences: who they are.' },
            personality: { type: 'string' },
            background: { type: 'string' },
            appearance: { type: 'string' },
            speech: { type: 'object', properties: { style: { type: 'string' }, examples: { type: 'array', items: { type: 'string' } } }, required: ['style'], additionalProperties: false },
            state: { type: 'object', properties: { public_state: { type: 'string' }, inner_state: { type: 'string' }, activity: { type: 'string' } }, additionalProperties: false },
            place: { type: 'object', properties: { location: placeKey, position: { type: 'string' }, feature: { type: 'string' } }, required: ['location'], additionalProperties: false },
            note: { type: 'string', description: 'Why they were made, for whoever fits them into the world later.' },
          },
          required: ['key', 'name', 'summary'],
          additionalProperties: false,
        },
      },
    })
  }
  if (options.changes === true) {
    Object.assign(properties, {
      event_edits: {
        type: 'array',
        description: 'Corrections to draft events of this run (a sealed event cannot change). Give only what changes; perceived_by replaces the whole list.',
        items: {
          type: 'object',
          properties: { id: { type: 'integer' }, text: { type: 'string' }, importance: IMPORTANCE, tags: { type: 'array', items: { type: 'string' } }, involves: keys, perceived_by: perceivedBy, location: placeKey },
          required: ['id'],
          additionalProperties: false,
        },
      },
      event_retractions: { type: 'array', items: { type: 'integer' }, description: 'Ids of recorded events that did not happen or duplicate another.' },
      perception_edits: {
        type: 'array',
        description: 'Revisions of what a character took in of an event (the ids are in read_records): it learned more, or remembers it differently. Allowed on any event.',
        items: {
          type: 'object',
          properties: {
            id: { type: 'integer' },
            mode: { type: 'string', enum: [...PERCEPTION_MODES] },
            content: { type: 'string' },
            gist: { type: 'string' },
            accuracy: { type: 'string', enum: [...ACCURACIES] },
          },
          required: ['id'],
          additionalProperties: false,
        },
      },
      perceptions_added: {
        type: 'array',
        description: 'A character that took in an earlier event only now (it was told, or worked it out). Allowed on any event.',
        items: {
          type: 'object',
          properties: {
            event: { type: 'integer' },
            character,
            mode: { type: 'string', enum: [...PERCEPTION_MODES] },
            content: { type: 'string' },
            gist: { type: 'string' },
            accuracy: { type: 'string', enum: [...ACCURACIES] },
          },
          required: ['event', 'character', 'mode'],
          additionalProperties: false,
        },
      },
      belief_edits: {
        type: 'array',
        items: { type: 'object', properties: { id: { type: 'integer' }, text: { type: 'string' }, about: keys, importance: IMPORTANCE }, required: ['id'], additionalProperties: false },
      },
      belief_retractions: { type: 'array', items: { type: 'integer' } },
    })
  }
  return { type: 'object', properties, required: ['turn'], additionalProperties: false }
}
