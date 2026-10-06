import {
  ACCURACIES, CHARACTER_KINDS, CHARACTER_TIERS, CONTAINER_STATES, EXIT_STATES, IMPORTANCE_MAX, IMPORTANCE_MIN, INTENT_HORIZONS, INTENT_TYPES, KNOWLEDGE_KINDS, MAX_LOCATION_FEATURES, MEMBERSHIP_STATUSES, MEMORY_KINDS, PERCEPTION_MODES, SLOT_ID,
  type CharacterId, type CharacterStatePatch, type Holder, type Location, type LocationFeature, type NewPerception, type RelationshipPatch,
} from 'dsh-roleplay-model'
import { InvalidEditError, InvalidMoveError } from '../errors.ts'
import { lookupKey } from '../sqlite/support.ts'
import { characterKey, locationKey, type EditResult, type NewExit, type NewPlace, type PerceivedBy, type RecordsEdit, type RecordsTarget } from './edit-types.ts'
import { prepareAgenda, writeAgenda } from './agenda-edit.ts'
import { ITEM_ACTIONS, changeItem } from './items.ts'
import { moveCharacter } from './movement.ts'
import { triggerReferenceProblems } from './trigger-rules.ts'
import { changeVariable, planVariableChange } from './variables.ts'

export * from './edit-types.ts'
export { parseRecordsEdit, recordsEditSchema } from './wire.ts'

const present = (value: string | undefined): boolean => value !== undefined && value.trim() !== ''
const list = <T>(value: readonly T[] | undefined): readonly T[] => value ?? []

/** Makes the triggers of an edit, after everything else in it, so that they can name what it made. @throws {InvalidEditError} naming each problem. */
function createTriggers(target: RecordsTarget, edit: RecordsEdit): string[] {
  const made = list(edit.triggers)
  const keys = made.map(definition => definition.key)
  const problems = [
    ...made.flatMap(definition => triggerReferenceProblems(target, definition, keys)),
    ...keys.flatMap((key, index) => (keys.indexOf(key) === index ? [] : [`${key}: made twice in this edit`])),
    ...keys.flatMap(key => (target.triggers.getByKey(key) === undefined ? [] : [`${key}: there is already a trigger with this key`])),
  ]
  if (problems.length > 0) throw new InvalidEditError(problems)
  for (const definition of made) target.triggers.add(definition, 'story', edit.turn)
  return keys
}

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
  const factionByKey = new Map(target.factions.list().map(faction => [faction.sourceId ?? String(faction.id), faction]))
  const factionIdOf = (key: string, where: string): number | undefined => { const found = factionByKey.get(key); if (found === undefined) problems.push(`${where}: there is no faction "${key}"`); return found?.id }
  const socialIdOf = (kind: 'character' | 'faction', key: string, where: string): number | undefined => kind === 'character' ? idOf(key, where) : factionIdOf(key, where)
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
  const itemFor = (key: string) => target.items.getBySourceId(key) ?? (Number.isInteger(Number(key)) ? target.items.get(Number(key)) : undefined)
  const knowledgeSubject = (entry: { kind: string; subject?: string; from?: string; to?: string }, where: string): { kind: 'location' | 'item' | 'exit'; id: number } | undefined => {
    if (!KNOWLEDGE_KINDS.includes(entry.kind as never)) { problems.push(`${where}: unknown kind "${entry.kind}"`); return undefined }
    if (entry.kind === 'location') {
      const place = entry.subject === undefined ? undefined : existingPlaces.get(entry.subject)
      if (place === undefined) problems.push(`${where}.subject: there is no place "${entry.subject ?? ''}"`)
      return place === undefined ? undefined : { kind: 'location', id: place.id }
    }
    if (entry.kind === 'item') {
      const item = entry.subject === undefined ? undefined : itemFor(entry.subject)
      if (item === undefined) problems.push(`${where}.subject: there is no item "${entry.subject ?? ''}"`)
      return item === undefined ? undefined : { kind: 'item', id: item.id }
    }
    const from = entry.from === undefined ? undefined : existingPlaces.get(entry.from)
    const to = entry.to === undefined ? undefined : existingPlaces.get(entry.to)
    const exit = from === undefined || to === undefined ? undefined : target.locations.getExit(from.id, to.id)
    if (exit === undefined) problems.push(`${where}: there is no exit from "${entry.from ?? ''}" to "${entry.to ?? ''}"`)
    return exit === undefined ? undefined : { kind: 'exit', id: exit.id }
  }
  const knowledge = list(edit.knowledge).map((entry, index) => ({ entry, character: idOf(entry.character, `knowledge[${index}].character`), subject: knowledgeSubject(entry, `knowledge[${index}]`) }))
  const knowledgeRetractions = list(edit.knowledgeRetractions).map((entry, index) => {
    const character = idOf(entry.character, `knowledge_retractions[${index}].character`)
    const subject = knowledgeSubject(entry, `knowledge_retractions[${index}]`)
    if (character !== undefined && subject !== undefined && !target.knowledge.knows(character, subject.kind, subject.id)) problems.push(`knowledge_retractions[${index}]: the character does not know that entity`)
    return { character, subject }
  })
  const factionStates = list(edit.factionStates).map((entry, index) => {
    const where = `faction_states[${index}]`
    if (entry.publicState === undefined && entry.innerState === undefined) problems.push(`${where}: nothing to change`)
    return { entry, faction: factionIdOf(entry.faction, where) }
  })
  const factionMemberships = list(edit.factionMemberships).map((entry, index) => {
    const where = `faction_memberships[${index}]`
    const faction = factionIdOf(entry.faction, `${where}.faction`)
    const character = idOf(entry.character, `${where}.character`)
    if (entry.status !== undefined && !MEMBERSHIP_STATUSES.includes(entry.status)) problems.push(`${where}: unknown status "${String(entry.status)}"`)
    if (entry.commitment !== undefined && (!Number.isFinite(entry.commitment) || entry.commitment < 0 || entry.commitment > 1)) problems.push(`${where}: commitment must be a number from 0 to 1`)
    return { entry, faction, character }
  })
  const factionRelationships = list(edit.factionRelationships).map((entry, index) => {
    const where = `faction_relationships[${index}]`
    if (!['character', 'faction'].includes(entry.fromKind)) problems.push(`${where}.from_kind: must be character or faction`)
    if (!['character', 'faction'].includes(entry.toKind)) problems.push(`${where}.to_kind: must be character or faction`)
    const from = socialIdOf(entry.fromKind, entry.from, `${where}.from`)
    const to = socialIdOf(entry.toKind, entry.to, `${where}.to`)
    if (entry.fromKind === entry.toKind && entry.from === entry.to) problems.push(`${where}: an entity has no relationship with itself`)
    if (from !== undefined && to !== undefined && target.factionRelationships.get(entry.fromKind, from, entry.toKind, to) === undefined && !present(entry.label)) problems.push(`${where}: a new relationship needs a label`)
    for (const [axis, [min, max]] of Object.entries(RELATION_RANGES) as [keyof typeof RELATION_RANGES, readonly [number, number]][]) { const value = entry[axis]; if (value !== undefined && (!Number.isFinite(value) || value < min || value > max)) problems.push(`${where}: ${axis} must be a number from ${min} to ${max}`) }
    return { entry, from, to }
  })
  const factionIntents = list(edit.factionIntentsAdded).map((entry, index) => {
    const where = `faction_intents_added[${index}]`
    const faction = factionIdOf(entry.faction, `${where}.faction`)
    if (!INTENT_TYPES.includes(entry.type)) problems.push(`${where}: unknown type "${String(entry.type)}"`)
    if (!INTENT_HORIZONS.includes(entry.horizon)) problems.push(`${where}: unknown horizon "${String(entry.horizon)}"`)
    if (!present(entry.name)) problems.push(`${where}: give the goal a name`)
    for (const [key, value] of [['priority', entry.priority], ['urgency', entry.urgency]] as const) if (!Number.isFinite(value) || value < 0 || value > 1) problems.push(`${where}.${key}: must be a number from 0 to 1`)
    return { entry, faction }
  })
  list(edit.itemChanges).forEach((change, index) => {
    const where = `item_changes[${index}]`
    idOf(change.character, where)
    if (!ITEM_ACTIONS.includes(change.action)) problems.push(`${where}: unknown action "${String(change.action)}" (the actions are: ${ITEM_ACTIONS.join(', ')})`)
    if (change.exit === undefined && itemFor(change.item) === undefined) problems.push(`${where}: there is no item "${change.item}" (list_items shows the keys)`)
  })
  list(edit.itemEdits).forEach((change, index) => {
    const where = `item_edits[${index}]`
    const item = itemFor(change.item)
    if (item === undefined) { problems.push(`${where}: there is no item "${change.item}"`); return }
    if (change.state !== undefined && (item.container === undefined || !CONTAINER_STATES.includes(change.state))) problems.push(`${where}: ${item.container === undefined ? `${item.name} is not a container` : `unknown container state "${String(change.state)}"`}`)
    if (change.quantity !== undefined && (!Number.isInteger(change.quantity) || change.quantity < 1)) problems.push(`${where}: the quantity must be a whole number from 1`)
    if (change.owner !== undefined && !byKey.has(change.owner)) problems.push(`${where}.owner: there is no character "${change.owner}"`)
    for (const key of list(change.openedBy)) if (itemFor(key) === undefined) problems.push(`${where}.opened_by: there is no item "${key}"`)
    if (change.openedBy !== undefined && item.container === undefined) problems.push(`${where}: ${item.name} is not a container, so nothing opens it`)
    if (change.description !== undefined && !present(change.description)) problems.push(`${where}: the description cannot be empty`)
  })
  list(edit.events).forEach((event, index) => { for (const key of list(event.items)) if (itemFor(key) === undefined) problems.push(`events[${index}].items: there is no item "${key}"`) })
  const placeIn = (key: string | undefined, where: string): void => { if (key !== undefined) placeKnown(key, where) }
  list(edit.events).forEach((event, index) => { placeIn(event.location, `events[${index}].location`) })
  list(edit.eventEdits).forEach((change, index) => { placeIn(change.location, `event_edits[${index}].location`) })

  if (!Number.isInteger(edit.turn) || edit.turn < 1) problems.push('turn must be a whole number from 1')

  const states = list(edit.states).flatMap((patch, index) => {
    const where = `states[${index}]`
    const id = idOf(patch.character, where)
    if (!present(patch.publicState) && !present(patch.innerState) && !present(patch.activity)) problems.push(`${where}: nothing to change`)
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

  list(edit.variableChanges).forEach((change, index) => {
    const where = `variable_changes[${index}]`
    if (list(edit.variables).some(def => def.key === change.variable)) return
    const planned = planVariableChange(target, change)
    if (!planned.ok) problems.push(...planned.problems.map(problem => `${where}: ${problem}`))
  })
  const agenda = prepareAgenda(target, edit, { idOf, placeKnown, places: existingPlaces, problems })

  if (problems.length > 0) throw new InvalidEditError(problems)

  return target.transaction(() => {
    const result: EditResult = { eventIds: [], beliefIds: [], writes: 0 }
    const learnEventEntities = (event: { turn: number; locationId?: number; items: readonly number[]; involves: readonly number[] }, characterId: number): void => {
      if (event.locationId !== undefined) target.knowledge.learn(characterId, 'location', event.locationId, event.turn)
      for (const itemId of event.items) target.knowledge.learn(characterId, 'item', itemId, event.turn)
      for (const otherId of event.involves) if (otherId !== characterId && target.relationships.get(characterId, otherId) === undefined) target.relationships.upsert(characterId, otherId, { label: 'acquaintance' }, event.turn)
    }
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
    for (const { entry, character, subject } of knowledge) {
      target.knowledge.learn(character!, subject!.kind, subject!.id, edit.turn, entry.observed === true)
      result.writes += 1
    }
    for (const { character, subject } of knowledgeRetractions) {
      target.knowledge.forget(character!, subject!.kind, subject!.id)
      result.writes += 1
    }
    for (const { entry, faction } of factionStates) {
      target.factionStates.update(faction!, { ...(entry.publicState === undefined ? {} : { publicState: entry.publicState }), ...(entry.innerState === undefined ? {} : { innerState: entry.innerState }) })
      result.writes += 1
    }
    for (const { entry, faction, character } of factionMemberships) {
      const { faction: _faction, character: _character, ...patch } = entry
      target.factionMemberships.upsert(faction!, character!, patch, edit.turn)
      if (target.factionRelationships.get('character', character!, 'faction', faction!) === undefined) target.factionRelationships.upsert('character', character!, 'faction', faction!, { label: entry.role || 'member', familiarity: 1 }, edit.turn)
      result.writes += 1
    }
    for (const { entry, from, to } of factionRelationships) {
      const { fromKind, from: _from, toKind, to: _to, ...patch } = entry
      target.factionRelationships.upsert(fromKind, from!, toKind, to!, patch, edit.turn)
      result.writes += 1
    }
    for (const { entry, faction } of factionIntents) {
      target.factionIntents.add(faction!, { type: entry.type, name: entry.name.trim(), description: entry.description?.trim() ?? '', status: 'active', horizon: entry.horizon, priority: entry.priority, urgency: entry.urgency, plan: entry.plan ?? [], openThreads: [], constraints: entry.constraints ?? [], ...(entry.deadline === undefined ? {} : { deadline: entry.deadline }) })
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
    for (const [index, change] of list(edit.itemChanges).entries()) {
      const { character: who, ...spec } = change
      try {
        changeItem(target, byKey.get(who)!.id, spec)
      } catch (error) {
        if (error instanceof InvalidMoveError) throw new InvalidEditError(error.problems.map(problem => `item_changes[${index}]: ${problem}`))
        throw error
      }
      result.writes += 1
    }
    for (const change of list(edit.itemEdits)) {
      const item = itemFor(change.item)!
      target.items.update(item.id, {
        ...(change.description === undefined ? {} : { description: change.description }), ...(change.quality === undefined ? {} : { quality: change.quality }),
        ...(change.quantity === undefined ? {} : { quantity: change.quantity }), ...(change.notable === undefined ? {} : { notable: change.notable }),
        ...(change.hidden === undefined ? {} : { hidden: change.hidden }), ...(change.state === undefined ? {} : { container: { state: change.state } }),
        ...(change.owner === undefined ? {} : { ownerId: byKey.get(change.owner)!.id }),
      })
      if (change.openedBy !== undefined) target.items.setOpeners({ kind: 'item', id: item.id }, change.openedBy.map(key => itemFor(key)!.id))
      result.writes += 1
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
      const { character: _character, ...fields } = patch
      const written: CharacterStatePatch = {
        ...(present(fields.publicState) ? { publicState: fields.publicState!.trim() } : {}),
        ...(present(fields.innerState) ? { innerState: fields.innerState!.trim() } : {}),
        ...(present(fields.activity) ? { activity: fields.activity!.trim() } : {}),
      }
      if (current === undefined) {
        target.characterStates.create(id, { publicState: written.publicState ?? '', innerState: written.innerState ?? '', activity: written.activity ?? '' })
      } else {
        target.characterStates.update(id, written)
      }
      result.writes += 1
    }
    for (const { event, involves, perceived } of events) {
      const { event: stored } = target.events.add({ turn: event.turn, round: event.round, text: event.text.trim(), importance: event.importance, tags: tags(event.tags), involves, ...(event.items === undefined ? {} : { items: event.items.map(key => itemFor(key)!.id) }), ...(event.location === undefined ? {} : { locationId: placeOf(event.location).id }) }, perceived)
      for (const perception of perceived) learnEventEntities(stored, perception.characterId)
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
    for (const { eventId, perception } of perceptionsAdded) {
      target.events.addPerception(eventId, perception)
      learnEventEntities(target.events.get(eventId)!, perception.characterId)
      result.writes += 1
    }
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
    result.variableKeys = []
    for (const [index, spec] of list(edit.variables).entries()) {
      try {
        target.variables.define(spec)
        result.variableKeys.push(spec.key)
      } catch (error) {
        throw error instanceof Error ? new InvalidEditError([`variables[${index}]: ${error.message}`]) : error
      }
      result.writes += 1
    }
    for (const [index, change] of list(edit.variableChanges).entries()) {
      try {
        changeVariable(target, change, edit.turn)
      } catch (error) {
        if (error instanceof InvalidEditError) throw new InvalidEditError(error.problems.map(problem => `variable_changes[${index}]: ${problem}`))
        throw error
      }
      result.writes += 1
    }
    result.writes += writeAgenda(target, agenda, edit.turn, key => placeOf(key).id)
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
 * Make up the slots and items of an edit: validated first, then written, each item put where it starts and
 * queued to be fitted into the world. Containers that hold other new items are made first.
 */
function createItems(target: RecordsTarget, edit: RecordsEdit): { keys: string[]; writes: number } {
  const problems: string[] = []
  const slotsWanted = list(edit.slots)
  slotsWanted.forEach((slot, index) => {
    const where = `slots[${index}]`
    if (!SLOT_ID.test(slot.id)) problems.push(`${where}: the id must be lowercase letters, digits, "-" or "_"`)
    if (!present(slot.name)) problems.push(`${where}: give the slot a name`)
    if (!Number.isInteger(slot.capacity) || slot.capacity < 1) problems.push(`${where}: the capacity must be a whole number from 1`)
  })
  const slotIds = new Set([...target.slots.list().map(slot => slot.id), ...slotsWanted.map(slot => slot.id)])
  const wanted = list(edit.items)
  const newKeys = new Set(wanted.map(spec => spec.key))
  const known = (key: string): boolean => target.items.getBySourceId(key) !== undefined || (Number.isInteger(Number(key)) && target.items.get(Number(key)) !== undefined) || newKeys.has(key)
  const placeFor = (key: string): Location | undefined => target.locations.getBySourceId(key) ?? (Number.isInteger(Number(key)) ? target.locations.get(Number(key)) : undefined)
  const characterFor = (key: string) => target.characters.list().find(character => characterKey(character) === key)
  const seen = new Set<string>()
  wanted.forEach((spec, index) => {
    const where = `items[${index}]`
    if (!present(spec.key) || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,59}$/.test(spec.key)) problems.push(`${where}: give the item a key of letters, digits, "-" or "_"`)
    else if (target.items.getBySourceId(spec.key) !== undefined || seen.has(spec.key)) problems.push(`${where}: the key "${spec.key}" is already used by an item`)
    seen.add(spec.key)
    if (!present(spec.name)) problems.push(`${where}: give the item a name`)
    if (spec.quantity !== undefined && (!Number.isInteger(spec.quantity) || spec.quantity < 1)) problems.push(`${where}: the quantity must be a whole number from 1`)
    if (spec.unique === true && (spec.quantity ?? 1) > 1) problems.push(`${where}: a unique item is one thing`)
    if (spec.wearable !== undefined && !slotIds.has(spec.wearable)) problems.push(`${where}: there is no slot "${spec.wearable}" (the slots are: ${[...slotIds].join(', ')}; make a new one in slots when the world needs it)`)
    if (spec.container?.state !== undefined && !CONTAINER_STATES.includes(spec.container.state)) problems.push(`${where}: unknown container state "${String(spec.container.state)}"`)
    for (const key of list(spec.container?.openedBy)) if (!known(key)) problems.push(`${where}.container.opened_by: there is no item "${key}"`)
    if (spec.owner !== undefined && characterFor(spec.owner) === undefined) problems.push(`${where}.owner: there is no character "${spec.owner}"`)
    const holders = [spec.at, spec.heldBy, spec.wornBy, spec.inside].filter(holder => holder !== undefined).length
    if (holders !== 1) problems.push(`${where}: say where it starts with exactly one of at (lying in a place: {"location": place key}), held_by (a character's key), worn_by (a character's key) or inside (a container item's key)${holders === 0 ? '; it has none yet' : '; it has more than one'}`)
    if (spec.at !== undefined) {
      const place = placeFor(spec.at.location)
      if (place === undefined) problems.push(`${where}.at: there is no place "${spec.at.location}"`)
      else if (spec.at.feature !== undefined && !place.features.some(feature => feature.key === spec.at!.feature)) problems.push(`${where}.at: ${place.name} has no feature "${spec.at.feature}"`)
    }
    for (const [field, key] of [['held_by', spec.heldBy], ['worn_by', spec.wornBy]] as const) {
      if (key !== undefined && characterFor(key) === undefined) problems.push(`${where}.${field}: there is no character "${key}"`)
    }
    if (spec.wornBy !== undefined && spec.wearable === undefined) problems.push(`${where}: it is worn but not wearable: give it a wearable slot`)
    if (spec.inside !== undefined && !known(spec.inside)) problems.push(`${where}.inside: there is no item "${spec.inside}"`)
    if (spec.inside === spec.key) problems.push(`${where}: an item cannot be inside itself`)
    // The same thing twice in the same hands or place is the same thing: change its quantity instead.
    const duplicate = (holder: Holder | undefined): boolean => holder !== undefined && target.items.contents(holder.kind === 'location' ? { kind: 'location', id: holder.locationId } : holder.kind === 'character' ? { kind: 'character', id: holder.characterId } : { kind: 'item', id: holder.itemId }).some(({ item }) => lookupKey(item.name) === lookupKey(spec.name ?? ''))
    const where2: Holder | undefined = spec.at !== undefined && placeFor(spec.at.location) !== undefined ? { kind: 'location', locationId: placeFor(spec.at.location)!.id } : spec.heldBy !== undefined && characterFor(spec.heldBy) !== undefined ? { kind: 'character', characterId: characterFor(spec.heldBy)!.id, mode: 'held' } : undefined
    if (duplicate(where2)) problems.push(`${where}: "${spec.name}" is already there: change its quantity instead of making another`)
  })
  if (problems.length > 0) throw new InvalidEditError(problems)

  for (const slot of slotsWanted) target.slots.upsert(slot)
  const made = new Map<string, number>()
  const itemId = (key: string): number => made.get(key) ?? (target.items.getBySourceId(key) ?? target.items.get(Number(key)))!.id
  const pending = [...wanted]
  while (pending.length > 0) {
    const index = pending.findIndex(spec => spec.inside === undefined || !newKeys.has(spec.inside) || made.has(spec.inside))
    if (index < 0) throw new InvalidEditError(['items: they are inside each other in a circle'])
    const [spec] = pending.splice(index, 1)
    const holder: Holder = spec!.at !== undefined
      ? { kind: 'location', locationId: placeFor(spec!.at.location)!.id, ...(spec!.at.position === undefined ? {} : { position: spec!.at.position }), ...(spec!.at.feature === undefined ? {} : { featureKey: spec!.at.feature }) }
      : spec!.heldBy !== undefined ? { kind: 'character', characterId: characterFor(spec!.heldBy)!.id, mode: 'held' }
        : spec!.wornBy !== undefined ? { kind: 'character', characterId: characterFor(spec!.wornBy)!.id, mode: 'worn', slot: spec!.wearable!, ...(spec!.wornPosition === undefined ? {} : { position: spec!.wornPosition }) }
          : { kind: 'item', itemId: itemId(spec!.inside!), ...(spec!.insidePosition === undefined ? {} : { position: spec!.insidePosition }) }
    const added = target.items.add({
      sourceId: spec!.key, name: spec!.name.trim(), description: spec!.description ?? '', quantity: spec!.quantity ?? 1, unique: spec!.unique ?? false, quality: spec!.quality ?? '',
      notable: spec!.notable ?? false, hidden: spec!.hidden ?? false, ...(spec!.wearable === undefined ? {} : { wearableSlot: spec!.wearable }),
      ...(spec!.container === undefined ? {} : { container: { state: spec!.container.state ?? 'closed' } }), ...(spec!.owner === undefined ? {} : { ownerId: characterFor(spec!.owner)!.id }),
    }, holder)
    made.set(spec!.key, added.id)
    target.consolidation.enqueue({ kind: 'item', subjectId: added.id, note: spec!.note ?? 'made up in play', turn: edit.turn })
  }
  for (const spec of wanted) {
    if (spec.container?.openedBy !== undefined && spec.container.openedBy.length > 0) target.items.setOpeners({ kind: 'item', id: made.get(spec.key)! }, spec.container.openedBy.map(itemId))
  }
  return { keys: wanted.map(spec => spec.key), writes: wanted.length + slotsWanted.length }
}

/**
 * Apply an edit. Every problem is found before anything is written, so a bad edit changes nothing.
 * Characters made up by the edit are created after its places and before everything else, so that the rest
 * of the edit (relationships, events, moves) can name them; the whole is still one transaction.
 * @throws {InvalidEditError} naming each problem.
 */
export function applyRecordsEdit(target: RecordsTarget, edit: RecordsEdit): EditResult {
  if (list(edit.triggers).length > 0) {
    return target.transaction(() => {
      const done = applyRecordsEdit(target, { ...edit, triggers: [] })
      return { ...done, triggerKeys: createTriggers(target, edit) }
    })
  }
  if (list(edit.characters).length === 0 && list(edit.items).length === 0 && list(edit.slots).length === 0) return applyChanges(target, edit)
  return target.transaction(() => {
    const placesFirst = applyChanges(target, { turn: edit.turn, places: list(edit.places) as NewPlace[] })
    const people = list(edit.characters).length === 0 ? { keys: [] as string[], writes: 0 } : createCharacters(target, edit)
    const things = list(edit.items).length === 0 && list(edit.slots).length === 0 ? { keys: [] as string[], writes: 0 } : createItems(target, edit)
    const rest = applyChanges(target, { ...edit, places: [], characters: [], items: [], slots: [] })
    return {
      eventIds: rest.eventIds, beliefIds: rest.beliefIds, writes: placesFirst.writes + people.writes + things.writes + rest.writes,
      characterKeys: people.keys, placeKeys: placesFirst.placeKeys ?? [], itemKeys: things.keys,
    }
  })
}
