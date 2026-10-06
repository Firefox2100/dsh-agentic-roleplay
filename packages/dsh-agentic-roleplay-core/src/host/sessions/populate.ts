import { WEEKDAY_NAMES, type TriggerDefinition, type VariableDefinitionInput, type VariableSubject, type VariableValue, type CharacterDefinition, type Holder, type ItemDefinition, type LocationDefinition, type Slot } from 'dsh-roleplay-model'
import { MINUTE, parseTimeOfDay, triggerReferenceProblems, type Session } from 'dsh-roleplay-state'
import { InvalidWorldError } from './errors.ts'
import { TRIGGERS_FILE_NAME } from '../triggers/load.ts'
import type { ChatSettings } from '../../shared/settings.ts'
import { containersFirst } from '../items/load.ts'
import { parentsFirst } from '../locations/load.ts'

/** What is wrong with how the characters stand towards each other, found before anything is created. */
export function relationshipProblems(characters: readonly CharacterDefinition[]): string[] {
  const ids = new Set(characters.map(character => character.id))
  return characters.flatMap(character => (character.relationships ?? []).flatMap((relation) => {
    if (relation.to === character.id) return [`${character.id}: relationships: a character has no relationship with itself`]
    return ids.has(relation.to) ? [] : [`${character.id}: relationships: "${relation.to}" is not a character of this world`]
  }))
}

/** What is wrong with the places, things and directed ways characters are authored to know. */
export function knowledgeProblems(characters: readonly CharacterDefinition[], locations: readonly LocationDefinition[], items: readonly ItemDefinition[]): string[] {
  const places = new Map(locations.map(location => [location.id, location]))
  const things = new Set(items.map(item => item.id))
  return characters.flatMap(character => {
    const prefix = `${character.id}: knowledge`
    const knowledge = character.knowledge
    if (knowledge === undefined) return []
    return [
      ...knowledge.locations.flatMap(key => places.has(key) ? [] : [`${prefix}.locations: "${key}" is not a place of this world`]),
      ...knowledge.items.flatMap(key => things.has(key) ? [] : [`${prefix}.items: "${key}" is not an item of this world`]),
      ...knowledge.exits.flatMap(({ from, to }) => places.get(from)?.exits.some(exit => exit.to === to) === true ? [] : [`${prefix}.exits: there is no exit from "${from}" to "${to}"`]),
    ]
  })
}

/** What is wrong with where the characters start, found before anything is created. */
export function startingPlaceProblems(characters: readonly CharacterDefinition[], locations: readonly LocationDefinition[]): string[] {
  const byId = new Map(locations.map(location => [location.id, location]))
  return characters.flatMap((character) => {
    const place = character.start.place
    if (place === undefined) return []
    const location = byId.get(place.location)
    if (location === undefined) return [`${character.id}: start.location "${place.location}" is not a place of this world`]
    if (place.feature !== undefined && !location.features.some(feature => feature.key === place.feature)) {
      return [`${character.id}: start.feature "${place.feature}" is not a feature of ${location.name} (it has: ${location.features.map(feature => feature.key).join(', ') || 'none'})`]
    }
    return []
  })
}

/** Declare what the world tracks and give everything the values it starts with. */
export function populateVariables(session: Session, defs: readonly VariableDefinitionInput[], world: { characters: readonly CharacterDefinition[]; items: readonly ItemDefinition[]; locations: readonly LocationDefinition[]; values: Record<string, VariableValue> | undefined }): void {
  for (const def of defs) session.variables.define(def)
  const give = (kind: VariableSubject, id: number, values: Record<string, VariableValue> | undefined): void => {
    for (const [key, value] of Object.entries(values ?? {})) session.variables.set(key, kind, id, { value }, 0)
  }
  for (const entry of world.characters) give('character', session.characters.getBySourceId(entry.id)!.id, entry.variables)
  for (const entry of world.items) give('item', session.items.getBySourceId(entry.id)!.id, entry.variables)
  for (const entry of world.locations) give('location', session.locations.getBySourceId(entry.id)!.id, entry.variables)
  give('world', 0, world.values)
}

/** What is wrong with the days characters are given, found before anything is created: places that are not in the world. */
export function routineProblems(characters: readonly CharacterDefinition[], locations: readonly LocationDefinition[]): string[] {
  const byId = new Map(locations.map(location => [location.id, location]))
  return characters.flatMap(character => (character.routine ?? []).flatMap((window, index) => {
    if (window.location === undefined) return []
    const location = byId.get(window.location)
    if (location === undefined) return [`${character.id}: routine[${index}].location "${window.location}" is not a place of this world`]
    if (window.feature !== undefined && !location.features.some(feature => feature.key === window.feature)) return [`${character.id}: routine[${index}].feature "${window.feature}" is not a feature of ${location.name}`]
    return []
  }))
}

/** Gives each character its recurring day, with the places by their ids in the world. */
export function populateRoutines(session: Session, characters: readonly CharacterDefinition[]): void {
  for (const { id, routine } of characters) {
    if (routine === undefined || routine.length === 0) continue
    session.routines.replace(session.characters.getBySourceId(id)!.id, routine.map(window => ({
      days: window.days.map(day => WEEKDAY_NAMES.indexOf(day as (typeof WEEKDAY_NAMES)[number])),
      start: parseTimeOfDay(window.from)!, end: parseTimeOfDay(window.to)!, activity: window.activity, interruptible: window.interruptible,
      ...(window.location === undefined ? {} : { locationId: session.locations.getBySourceId(window.location)!.id }),
      ...(window.feature === undefined ? {} : { featureKey: window.feature }), ...(window.position === undefined ? {} : { position: window.position }),
    })))
  }
}

/** Put a world's places into a new session: each inside the one it belongs to, with the ways between them (both ways unless the file says one way). */
export function populateLocations(session: Session, locations: readonly LocationDefinition[]): void {
  const ordered = parentsFirst(locations)
  for (const { id, name, description, parent, features, visualIdentity } of ordered) {
    const parentId = parent === undefined ? undefined : session.locations.getBySourceId(parent)?.id
    const stored = session.locations.add({ sourceId: id, name, description, features, ...(parentId === undefined ? {} : { parentId }) })
    if (visualIdentity !== undefined) session.visualIdentities.set('location', stored.id, visualIdentity)
  }
  for (const location of ordered) {
    const from = session.locations.getBySourceId(location.id)!
    for (const exit of location.exits) {
      const to = session.locations.getBySourceId(exit.to)!
      const shared = { ...(exit.travelSeconds === undefined ? {} : { travelSeconds: exit.travelSeconds }), state: exit.state, note: exit.note }
      if (session.locations.getExit(from.id, to.id) === undefined) session.locations.addExit({ fromId: from.id, toId: to.id, description: exit.description, ...shared })
      if (!exit.oneWay && session.locations.getExit(to.id, from.id) === undefined) session.locations.addExit({ fromId: to.id, toId: from.id, description: exit.backDescription ?? exit.description, ...shared })
    }
  }
}

/**
 * Put a world's cast into a new session: each character with the state it
 * starts in and its intents. The player controls the character whose world id
 * is `playerId`; the agent controls everyone else.
 */
export function populateCharacters(session: Session, characters: readonly CharacterDefinition[], playerId: string): void {
  for (const { id, start, relationships: _relationships, knowledge: _knowledge, routine: _routine, visualIdentity, ...identity } of characters) {
    const character = session.characters.add({ ...identity, sourceId: id, control: id === playerId ? 'player' : 'agent' })
    if (visualIdentity !== undefined) session.visualIdentities.set('character', character.id, visualIdentity)
    const { intents, place, emotion, ...state } = start
    session.characterStates.create(character.id, state)
    if (emotion !== undefined) {
      for (const axis of ['valence', 'arousal', 'dominance'] as const) session.variables.set(axis, 'character', character.id, { value: emotion.immediate[axis], baseline: emotion.baseline[axis] }, 0)
    }
    for (const intent of intents) session.intents.add(character.id, intent)
    if (place !== undefined) {
      const location = session.locations.getBySourceId(place.location)!
      session.placements.place('character', character.id, { locationId: location.id, ...(place.position === undefined ? {} : { position: place.position }), ...(place.feature === undefined ? {} : { featureKey: place.feature }) })
    }
  }
  for (const { id, relationships } of characters) {
    const from = session.characters.getBySourceId(id)!
    for (const relation of relationships ?? []) {
      session.relationships.upsert(from.id, session.characters.getBySourceId(relation.to)!.id, { label: relation.label, summary: relation.summary, familiarity: relation.familiarity, trust: relation.trust, affinity: relation.affinity, tension: relation.tension }, 0)
    }
  }
}

/** Give each character its authored knowledge, plus what is visible where it starts. */
export function populateKnowledge(session: Session, characters: readonly CharacterDefinition[]): void {
  for (const definition of characters) {
    const character = session.characters.getBySourceId(definition.id)!
    for (const key of definition.knowledge?.locations ?? []) session.knowledge.learn(character.id, 'location', session.locations.getBySourceId(key)!.id, 0)
    for (const key of definition.knowledge?.items ?? []) session.knowledge.learn(character.id, 'item', session.items.getBySourceId(key)!.id, 0)
    for (const wanted of definition.knowledge?.exits ?? []) {
      const exit = session.locations.getExit(session.locations.getBySourceId(wanted.from)!.id, session.locations.getBySourceId(wanted.to)!.id)!
      session.knowledge.learn(character.id, 'exit', exit.id, 0)
      session.knowledge.learn(character.id, 'location', exit.fromId, 0)
      session.knowledge.learn(character.id, 'location', exit.toId, 0)
    }
    const placement = session.placements.get('character', character.id)
    if (placement === undefined) continue
    session.knowledge.learn(character.id, 'location', placement.locationId, 0, true)
    for (const exit of session.locations.exitsFrom(placement.locationId)) {
      session.knowledge.learn(character.id, 'exit', exit.id, 0, true)
      session.knowledge.learn(character.id, 'location', exit.toId, 0)
    }
    for (const { item } of session.items.contents({ kind: 'location', id: placement.locationId })) if (!item.hidden) session.knowledge.learn(character.id, 'item', item.id, 0, true)
    for (const { item } of session.items.contents({ kind: 'character', id: character.id })) session.knowledge.learn(character.id, 'item', item.id, 0, true)
    for (const other of session.placements.at(placement.locationId, 'character')) {
      if (other.entityId !== character.id && session.relationships.get(character.id, other.entityId) === undefined) session.relationships.upsert(character.id, other.entityId, { label: 'acquaintance' }, 0)
    }
  }
}

/**
 * Put a world's slots and things into a new session, each where it starts, with what opens each lock. Containers come
 * before what is in them; what opens an exit is set for both directions of it.
 */
export function populateItems(session: Session, items: readonly ItemDefinition[], slots: readonly Slot[], locations: readonly LocationDefinition[]): void {
  for (const slot of slots) session.slots.upsert(slot)
  const made = new Map<string, number>()
  for (const definition of containersFirst(items)) {
    const { start } = definition
    const holder: Holder = start.kind === 'location'
      ? { kind: 'location', locationId: session.locations.getBySourceId(start.location)!.id, ...(start.position === undefined ? {} : { position: start.position }), ...(start.feature === undefined ? {} : { featureKey: start.feature }) }
      : start.kind === 'held' ? { kind: 'character', characterId: session.characters.getBySourceId(start.character)!.id, mode: 'held' }
        : start.kind === 'worn' ? { kind: 'character', characterId: session.characters.getBySourceId(start.character)!.id, mode: 'worn', slot: definition.wearable!, ...(start.position === undefined ? {} : { position: start.position }) }
          : { kind: 'item', itemId: made.get(start.item)!, ...(start.position === undefined ? {} : { position: start.position }) }
    const item = session.items.add({
      sourceId: definition.id, name: definition.name, description: definition.description, quantity: definition.quantity, unique: definition.unique, quality: definition.quality,
      notable: definition.notable, hidden: definition.hidden, ...(definition.wearable === undefined ? {} : { wearableSlot: definition.wearable }),
      ...(definition.container === undefined ? {} : { container: { state: definition.container.state } }),
      ...(definition.owner === undefined ? {} : { ownerId: session.characters.getBySourceId(definition.owner)!.id }),
    }, holder)
    if (definition.visualIdentity !== undefined) session.visualIdentities.set('item', item.id, definition.visualIdentity)
    made.set(definition.id, item.id)
  }
  for (const definition of items) {
    if (definition.container !== undefined && definition.container.openedBy.length > 0) {
      session.items.setOpeners({ kind: 'item', id: made.get(definition.id)! }, definition.container.openedBy.map(key => made.get(key)!))
    }
  }
  for (const place of locations) {
    const from = session.locations.getBySourceId(place.id)!
    for (const exit of place.exits) {
      if ((exit.openedBy ?? []).length === 0) continue
      const to = session.locations.getBySourceId(exit.to)!
      for (const [a, b] of [[from.id, to.id], [to.id, from.id]] as const) {
        const way = session.locations.getExit(a, b)
        if (way !== undefined) session.items.setOpeners({ kind: 'exit', id: way.id }, exit.openedBy!.map(key => made.get(key)!))
      }
    }
  }
}

/** Starts the story's clock: at the wall clock when it follows it, and otherwise at the world's starting time (or now, when the world has none). */
export function populateClock(session: Pick<Session, 'clock'>, settings: ChatSettings['clock'], world: { startingTime?: number } | undefined, wall: number): void {
  const start = settings.mode === 'real' ? wall : world?.startingTime ?? Math.floor(wall / MINUTE) * MINUTE
  session.clock.start(settings.mode, start)
}

/**
 * Make the world's triggers, once everything they can name exists.
 * @throws {Error} naming each trigger that names something the world does not have.
 */
export function populateTriggers(session: Session, definitions: readonly TriggerDefinition[]): void {
  const keys = definitions.map(definition => definition.key)
  const problems = definitions.flatMap(definition => triggerReferenceProblems(session, definition, keys))
  if (problems.length > 0) throw new InvalidWorldError(`the triggers have ${problems.length} problem(s)`, problems.map(message => ({ path: TRIGGERS_FILE_NAME, message })))
  for (const definition of definitions) session.triggers.add(definition, 'world', 0)
}
