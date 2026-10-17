import type { CharacterId } from 'dsh-roleplay-model'
import { characterKey, locationKey, type RecordsTarget } from './edit-types.ts'
import { itemKey } from './items.ts'
import { localIso } from './time.ts'
import { describeValue } from './variables.ts'

/** Which part of the story's records to read; all of it when left out. */
export interface RecordsScope {
  rounds?: readonly { turn: number; round: number }[]
  /** The time zone times are shown in; UTC when not given. */
  timeZone?: string
  /** Only these parts of the records; the others come back empty. Everything when left out. */
  only?: readonly (keyof RecordsView)[]
  /** Of the relationships, only those that changed in this turn or later. */
  relationshipsSince?: number
}

/** The records as models read them (snake_case, characters by key), the counterpart of the edit's wire format. */
export interface RecordsView {
  factions: { faction: string; name: string; public_state: string; inner_state: string; values: string[]; structure: string; goals: { id: number; name: string; status: string; horizon: string; priority: number; urgency: number; plan: string[] }[]; members: { character: string; role: string; rank: string; status: string; public: boolean; commitment: number }[] }[]
  faction_relationships: { from_kind: string; from: string; to_kind: string; to: string; label: string; summary: string; familiarity: number; trust: number; affinity: number; tension: number; updated_turn: number }[]
  characters: {
    character: string
    name: string
    controlled_by: 'the player' | 'an agent'
    public_state: string
    inner_state: string
    activity: string
    /** The key of the place it is in, and where in it; null while it is nowhere. */
    location: string | null
    position: string
    /** What it is after that is still live (active or paused), with the ids an edit refers to. */
    goals: { id: number; type: string; name: string; status: string; horizon: string; priority: number; urgency: number; deadline: string | null; plan: string[] }[]
  }[]
  events: {
    id: number
    turn: number
    round: number
    text: string
    importance: number
    tags: string[]
    involves: string[]
    /** The key of the place it happened in. */
    location: string | null
    sealed: boolean
    perceived_by: { id: number; character: string; mode: string; accuracy: string; content: string; gist: string }[]
  }[]
  beliefs: { id: number; character: string; kind: string; text: string; about: string[]; importance: number; confidence: string; evidence_for: number[]; evidence_against: number[]; turn: number }[]
  open_threads: { id: number; text: string; opened_turn: number }[]
  /** How characters stand towards each other, most recently changed first (at most 80). */
  /** Things, notable first (at most 100), each with where it is. */
  items: { key: string; name: string; quantity: number; quality: string; state: string | null; hidden: boolean; notable: boolean; owner: string | null; holder: string }[]
  /** What is tracked: how each kind of variable is declared. */
  variable_defs: { key: string; name: string; description: string; kind: string; subject: string; only: string[]; min: number | null; max: number | null; options: string[]; default: string | number | boolean; visibility: string; baseline: boolean }[]
  /** What each subject holds that is not the default (at most 200, most recently changed first). */
  variables: { variable: string; subject: string; about: string; value: string | number | boolean; described: string; baseline: string | number | boolean | null; visibility: string }[]
  /** What characters have committed to that is still pending, in the order they are due (at most 40); times in the story's time zone. */
  engagements: { id: number; title: string; at: string; until: string | null; location: string | null; participants: string[]; note: string }[]
  relationships: { from: string; to: string; label: string; summary: string; familiarity: number; trust: number; affinity: number; tension: number; updated_turn: number }[]
  knowledge: { character: string; kind: string; subject: string; learned_turn: number; last_observed_turn: number | null }[]
}

const MAX_RELATIONSHIPS_SHOWN = 80
const MAX_KNOWLEDGE_SHOWN = 200
const MAX_ITEMS_SHOWN = 100
const MAX_ENGAGEMENTS_SHOWN = 40
const MAX_VARIABLES_SHOWN = 200

/** Where an item is, in words. */
export function describeHolder(target: Pick<RecordsTarget, 'items' | 'locations' | 'characters'>, id: number, keyOfCharacter: (id: number) => string = String): string {
  const holding = target.items.holding(id)
  if (holding === undefined) return 'nowhere'
  const { holder } = holding
  if (holder.kind === 'location') return `at ${target.locations.get(holder.locationId)?.name ?? holder.locationId}${holder.position === undefined ? '' : ` (${holder.position})`}`
  if (holder.kind === 'item') return `inside ${target.items.get(holder.itemId)?.name ?? holder.itemId}`
  const who = keyOfCharacter(holder.characterId)
  return holder.mode === 'worn' ? `worn by ${who} on the ${holder.slot}` : `carried by ${who}`
}

/** Read the records back from the database, as the edit wrote them. */
export function readRecords(target: Omit<RecordsTarget, 'transaction'>, scope: RecordsScope = {}): RecordsView {
  const characters = target.characters.list()
  const factions = target.factions.list()
  const keyOf = (id: CharacterId): string => {
    const found = characters.find(character => character.id === id)
    return found === undefined ? String(id) : characterKey(found)
  }
  const factionKey = (id: number): string => { const faction = factions.find(entry => entry.id === id); return faction?.sourceId ?? String(id) }
  const socialKey = (kind: 'character' | 'faction', id: number): string => kind === 'character' ? keyOf(id) : factionKey(id)
  const places = new Map(target.locations.list().map(place => [place.id, locationKey(place)]))
  const placeKey = (id: number): string => places.get(id) ?? String(id)
  const where = (id: CharacterId): { location: string | null; position: string } => {
    const placement = target.placements.get('character', id)
    return placement === undefined ? { location: null, position: '' } : { location: placeKey(placement.locationId), position: placement.position }
  }
  const zone = scope.timeZone ?? 'UTC'
  const inScope = (turn: number, round?: number): boolean =>
    scope.rounds === undefined || scope.rounds.some(entry => entry.turn === turn && (round === undefined || entry.round === round))
  const view: RecordsView = {
    factions: factions.map((faction) => {
      const state = target.factionStates.get(faction.id)
      return { faction: factionKey(faction.id), name: faction.name, public_state: state?.publicState ?? '', inner_state: state?.innerState ?? '', values: faction.values, structure: faction.structure, goals: target.factionIntents.list(faction.id).filter(goal => goal.status === 'active' || goal.status === 'paused').map(goal => ({ id: goal.id, name: goal.name, status: goal.status, horizon: goal.horizon, priority: goal.priority, urgency: goal.urgency, plan: goal.plan })), members: target.factionMemberships.ofFaction(faction.id).map(member => ({ character: keyOf(member.characterId), role: member.role, rank: member.rank, status: member.status, public: member.public, commitment: member.commitment })) }
    }),
    faction_relationships: target.factionRelationships.list().filter(relation => scope.relationshipsSince === undefined || relation.updatedTurn >= scope.relationshipsSince).map(relation => ({ from_kind: relation.fromKind, from: socialKey(relation.fromKind, relation.fromId), to_kind: relation.toKind, to: socialKey(relation.toKind, relation.toId), label: relation.label, summary: relation.summary, familiarity: relation.familiarity, trust: relation.trust, affinity: relation.affinity, tension: relation.tension, updated_turn: relation.updatedTurn })),
    characters: characters.map((character) => {
      const state = target.characterStates.get(character.id)
      return {
        character: characterKey(character),
        name: character.name,
        controlled_by: character.control === 'player' ? 'the player' : 'an agent',
        public_state: state?.publicState ?? '',
        inner_state: state?.innerState ?? '',
        activity: state?.activity ?? '',
        ...where(character.id),
        goals: target.intents.list(character.id).filter(goal => goal.status === 'active' || goal.status === 'paused').map(goal => ({ id: goal.id, type: goal.type, name: goal.name, status: goal.status, horizon: goal.horizon, priority: goal.priority, urgency: goal.urgency, deadline: goal.deadline ?? null, plan: goal.plan })),
      }
    }),
    events: target.events.list().filter(event => inScope(event.turn, event.round)).map(event => ({
      id: event.id, turn: event.turn, round: event.round, text: event.text, importance: event.importance, tags: event.tags,
      involves: event.involves.map(keyOf), location: event.locationId === undefined ? null : placeKey(event.locationId), sealed: event.sealed,
      perceived_by: target.events.perceptionsOf(event.id).map(entry => ({ id: entry.id, character: keyOf(entry.characterId), mode: entry.mode, accuracy: entry.accuracy, content: entry.content, gist: entry.gist })),
    })),
    beliefs: characters.flatMap(character => target.memories.list(character.id)
      .filter(belief => inScope(belief.turn))
      .map(belief => { const evidence = target.memories.evidenceOf(belief.id); return { id: belief.id, character: characterKey(character), kind: belief.kind, text: belief.text, about: belief.about.map(keyOf), importance: belief.importance, confidence: belief.confidence, evidence_for: evidence.filter(entry => entry.relation === 'supports').map(entry => entry.perceptionId), evidence_against: evidence.filter(entry => entry.relation === 'contradicts').map(entry => entry.perceptionId), turn: belief.turn } })),
    open_threads: target.threads.list('open').map(thread => ({ id: thread.id, text: thread.text, opened_turn: thread.openedTurn })),
    items: [...target.items.list()].sort((a, b) => Number(b.notable) - Number(a.notable) || a.id - b.id).slice(0, MAX_ITEMS_SHOWN).map(item => ({
      key: itemKey(item), name: item.name, quantity: item.quantity, quality: item.quality, state: item.container?.state ?? null, hidden: item.hidden, notable: item.notable,
      owner: item.ownerId === undefined ? null : keyOf(item.ownerId), holder: describeHolder(target, item.id, keyOf),
    })),
    variable_defs: target.variables.defs().map(def => ({
      key: def.key, name: def.name, description: def.description, kind: def.kind, subject: def.subject, only: def.only, min: def.min ?? null, max: def.max ?? null, options: def.options, default: def.default, visibility: def.visibility, baseline: def.baseline,
    })),
    variables: target.variables.all().flatMap((entry) => {
      const def = target.variables.def(entry.variable)
      if (def === undefined || entry.value === def.default) return []
      const key = entry.subject === 'world' ? 'world' : entry.subject === 'character' ? keyOf(entry.subjectId) : entry.subject === 'item' ? (target.items.get(entry.subjectId) === undefined ? String(entry.subjectId) : itemKey(target.items.get(entry.subjectId)!)) : placeKey(entry.subjectId)
      const about = entry.subject === 'world' ? 'the world' : entry.subject === 'character' ? characters.find(character => character.id === entry.subjectId)?.name ?? key : entry.subject === 'item' ? target.items.get(entry.subjectId)?.name ?? key : target.locations.get(entry.subjectId)?.name ?? key
      return [{ variable: def.key, subject: key, about, value: entry.value, described: describeValue(def, entry.value), baseline: entry.baseline ?? null, visibility: def.visibility }]
    }).slice(0, MAX_VARIABLES_SHOWN),
    engagements: target.engagements.list({ status: 'pending' }).slice(0, MAX_ENGAGEMENTS_SHOWN).map(engagement => ({
      id: engagement.id, title: engagement.title, at: localIso(engagement.at, zone), until: engagement.until === undefined ? null : localIso(engagement.until, zone),
      location: engagement.locationId === undefined ? null : placeKey(engagement.locationId), participants: engagement.participants.map(keyOf), note: engagement.note,
    })),
    relationships: [...target.relationships.list()].filter(relation => scope.relationshipsSince === undefined || relation.updatedTurn >= scope.relationshipsSince).sort((a, b) => b.updatedTurn - a.updatedTurn || b.id - a.id).slice(0, MAX_RELATIONSHIPS_SHOWN).map(relation => ({
      from: keyOf(relation.fromId), to: keyOf(relation.toId), label: relation.label, summary: relation.summary,
      familiarity: relation.familiarity, trust: relation.trust, affinity: relation.affinity, tension: relation.tension, updated_turn: relation.updatedTurn,
    })),
    knowledge: characters.flatMap(character => target.knowledge.list(character.id).flatMap(entry => {
      let subject: string | undefined
      if (entry.subjectKind === 'location') {
        const place = target.locations.get(entry.subjectId)
        subject = place === undefined ? undefined : locationKey(place)
      } else if (entry.subjectKind === 'item') {
        const item = target.items.get(entry.subjectId)
        subject = item === undefined ? undefined : itemKey(item)
      } else {
        const exit = target.locations.allExits().find(candidate => candidate.id === entry.subjectId)
        subject = exit === undefined ? undefined : `${placeKey(exit.fromId)} -> ${placeKey(exit.toId)}`
      }
      return subject === undefined ? [] : [{ character: characterKey(character), kind: entry.subjectKind, subject, learned_turn: entry.learnedTurn, last_observed_turn: entry.lastObservedTurn ?? null }]
    })).slice(0, MAX_KNOWLEDGE_SHOWN),
  }
  return scope.only === undefined ? view : Object.fromEntries(Object.entries(view).map(([key, part]) => [key, scope.only!.includes(key as keyof RecordsView) ? part : []])) as unknown as RecordsView
}
