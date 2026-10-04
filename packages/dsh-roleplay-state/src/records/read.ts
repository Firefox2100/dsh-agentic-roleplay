import type { CharacterId } from 'dsh-roleplay-model'
import { characterKey, locationKey, type RecordsTarget } from './edit-types.ts'
import { itemKey } from './items.ts'
import { localIso } from './time.ts'

/** Which part of the story's records to read; all of it when left out. */
export interface RecordsScope {
  rounds?: readonly { turn: number; round: number }[]
  /** The time zone times are shown in; UTC when not given. */
  timeZone?: string
}

/** The records as models read them (snake_case, characters by key), the counterpart of the edit's wire format. */
export interface RecordsView {
  characters: {
    character: string
    name: string
    controlled_by: 'the player' | 'an agent'
    public_state: string
    inner_state: string
    activity: string
    emotion: { valence: number; arousal: number; dominance: number } | null
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
  beliefs: { id: number; character: string; kind: string; text: string; about: string[]; importance: number; turn: number }[]
  open_threads: { id: number; text: string; opened_turn: number }[]
  /** How characters stand towards each other, most recently changed first (at most 80). */
  /** Things, notable first (at most 100), each with where it is. */
  items: { key: string; name: string; quantity: number; quality: string; state: string | null; hidden: boolean; notable: boolean; owner: string | null; holder: string }[]
  /** What characters have committed to that is still pending, in the order they are due (at most 40); times in the story's time zone. */
  engagements: { id: number; title: string; at: string; until: string | null; location: string | null; participants: string[]; note: string }[]
  relationships: { from: string; to: string; label: string; summary: string; familiarity: number; trust: number; affinity: number; tension: number; updated_turn: number }[]
}

const MAX_RELATIONSHIPS_SHOWN = 80
const MAX_ITEMS_SHOWN = 100
const MAX_ENGAGEMENTS_SHOWN = 40

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
  const keyOf = (id: CharacterId): string => {
    const found = characters.find(character => character.id === id)
    return found === undefined ? String(id) : characterKey(found)
  }
  const places = new Map(target.locations.list().map(place => [place.id, locationKey(place)]))
  const placeKey = (id: number): string => places.get(id) ?? String(id)
  const where = (id: CharacterId): { location: string | null; position: string } => {
    const placement = target.placements.get('character', id)
    return placement === undefined ? { location: null, position: '' } : { location: placeKey(placement.locationId), position: placement.position }
  }
  const zone = scope.timeZone ?? 'UTC'
  const inScope = (turn: number, round?: number): boolean =>
    scope.rounds === undefined || scope.rounds.some(entry => entry.turn === turn && (round === undefined || entry.round === round))
  return {
    characters: characters.map((character) => {
      const state = target.characterStates.get(character.id)
      return {
        character: characterKey(character),
        name: character.name,
        controlled_by: character.control === 'player' ? 'the player' : 'an agent',
        public_state: state?.publicState ?? '',
        inner_state: state?.innerState ?? '',
        activity: state?.activity ?? '',
        emotion: state?.emotion === undefined ? null : { ...state.emotion.immediate },
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
      .map(belief => ({ id: belief.id, character: characterKey(character), kind: belief.kind, text: belief.text, about: belief.about.map(keyOf), importance: belief.importance, turn: belief.turn }))),
    open_threads: target.threads.list('open').map(thread => ({ id: thread.id, text: thread.text, opened_turn: thread.openedTurn })),
    items: [...target.items.list()].sort((a, b) => Number(b.notable) - Number(a.notable) || a.id - b.id).slice(0, MAX_ITEMS_SHOWN).map(item => ({
      key: itemKey(item), name: item.name, quantity: item.quantity, quality: item.quality, state: item.container?.state ?? null, hidden: item.hidden, notable: item.notable,
      owner: item.ownerId === undefined ? null : keyOf(item.ownerId), holder: describeHolder(target, item.id, keyOf),
    })),
    engagements: target.engagements.list({ status: 'pending' }).slice(0, MAX_ENGAGEMENTS_SHOWN).map(engagement => ({
      id: engagement.id, title: engagement.title, at: localIso(engagement.at, zone), until: engagement.until === undefined ? null : localIso(engagement.until, zone),
      location: engagement.locationId === undefined ? null : placeKey(engagement.locationId), participants: engagement.participants.map(keyOf), note: engagement.note,
    })),
    relationships: [...target.relationships.list()].sort((a, b) => b.updatedTurn - a.updatedTurn || b.id - a.id).slice(0, MAX_RELATIONSHIPS_SHOWN).map(relation => ({
      from: keyOf(relation.fromId), to: keyOf(relation.toId), label: relation.label, summary: relation.summary,
      familiarity: relation.familiarity, trust: relation.trust, affinity: relation.affinity, tension: relation.tension, updated_turn: relation.updatedTurn,
    })),
  }
}
