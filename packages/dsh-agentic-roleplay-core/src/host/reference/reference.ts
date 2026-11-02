import { existsSync } from 'node:fs'
import { isSessionId, locationKey, sessionDatabase, type Session } from '@dsh-agentic-roleplay/state'
import { SessionNotFoundError } from '../sessions/errors.ts'
import { keyOf, profileOf, type ProfileSession } from './profile.ts'
import { isReferenceSection, type ReferenceProfile, type ReferencePerson, type ReferencePlace, type ReferenceReplies, type ReferenceReply, type ReferenceSection, type ReferenceThing } from '../../shared/reference.ts'

export type ReferenceSession = Pick<Session, 'characters' | 'characterStates' | 'placements' | 'locations' | 'items' | 'knowledge' | 'relationships'> & ProfileSession

export class UnknownSectionError extends Error {}

/** What a page may be asked beyond its name. */
export interface PageOptions {
  /** Whose profile, by key; the player's own when absent. */
  character?: string
}

/** Where the player's character is and what it has met or learned of: the only ground a page may read from. */
function standpoint(session: ReferenceSession) {
  const player = session.characters.list().find(character => character.control === 'player')
  if (player === undefined) return undefined
  const placement = session.placements.get('character', player.id)
  const here = placement === undefined ? undefined : session.locations.get(placement.locationId)
  return { player, here }
}

/**
 * The player's character in full, or another character the player has met or is with, as an observer sees them.
 * Anyone the player's character has not met is not shown.
 */
function profile(session: ReferenceSession, options: PageOptions): ReferenceProfile[] {
  const stand = standpoint(session)
  if (stand === undefined) return []
  if (options.character === undefined || options.character === keyOf(stand.player)) return [profileOf(session, stand.player, 'self')]
  const seen = people(session).some(person => person.key === options.character)
  const other = seen ? session.characters.list().find(character => keyOf(character) === options.character) : undefined
  return other === undefined ? [] : [profileOf(session, other, 'observer')]
}

function people(session: ReferenceSession): ReferencePerson[] {
  const stand = standpoint(session)
  if (stand === undefined) return []
  const present = new Set(stand.here === undefined ? [] : session.placements.at(stand.here.id, 'character').map(entry => entry.entityId))
  const met = new Map(session.relationships.from(stand.player.id).map(relation => [relation.toId, relation]))
  return session.characters.list().flatMap((character): ReferencePerson[] => {
    if (character.id === stand.player.id || (!present.has(character.id) && !met.has(character.id))) return []
    const relation = met.get(character.id)
    return [{
      key: keyOf(character),
      name: character.name,
      publicState: session.characterStates.get(character.id)?.publicState ?? '',
      here: present.has(character.id),
      ...relation === undefined ? {} : { label: relation.label, summary: relation.summary },
    }]
  }).sort((a, b) => Number(b.here) - Number(a.here) || a.name.localeCompare(b.name))
}

function places(session: ReferenceSession): ReferencePlace[] {
  const stand = standpoint(session)
  if (stand === undefined) return []
  const known = new Set(session.knowledge.list(stand.player.id, 'location').map(entry => entry.subjectId))
  if (stand.here !== undefined) known.add(stand.here.id)
  const knownExits = new Set(session.knowledge.list(stand.player.id, 'exit').map(entry => entry.subjectId))
  const exits = session.locations.allExits()
  const placeOf = (id: number) => (known.has(id) ? session.locations.get(id) : undefined)
  const nameOf = (id: number): string | undefined => placeOf(id)?.name
  return [...known].flatMap((id): ReferencePlace[] => {
    const place = session.locations.get(id)
    if (place === undefined) return []
    const here = place.id === stand.here?.id
    const parent = place.parentId === undefined ? undefined : nameOf(place.parentId)
    return [{
      key: locationKey(place),
      name: place.name,
      here,
      ...parent === undefined ? {} : { parent },
      ...here ? { description: place.description } : {},
      features: here ? place.features.map(feature => feature.name) : [],
      ways: exits.filter(exit => exit.fromId === place.id && (here || knownExits.has(exit.id))).flatMap((exit) => {
        const to = placeOf(exit.toId)
        return to === undefined ? [] : [{ to: to.name, toKey: locationKey(to), open: exit.state === 'open' }]
      }),
    }]
  }).sort((a, b) => Number(b.here) - Number(a.here) || a.name.localeCompare(b.name))
}

function things(session: ReferenceSession): ReferenceThing[] {
  const stand = standpoint(session)
  if (stand === undefined) return []
  const carried = session.items.contents({ kind: 'character', id: stand.player.id }).filter(entry => !entry.item.hidden).map((entry): ReferenceThing => {
    const holder = entry.holding.holder
    return { name: entry.item.name, quantity: entry.item.quantity, where: holder.kind === 'character' && holder.mode === 'worn' ? 'worn' : 'carried' }
  })
  const around = stand.here === undefined ? [] : session.items.contents({ kind: 'location', id: stand.here.id }).filter(entry => !entry.item.hidden).map((entry): ReferenceThing => ({ name: entry.item.name, quantity: entry.item.quantity, where: 'here' }))
  return [...carried, ...around]
}

/** One page per section; a new page is a new entry here and in `REFERENCE_SECTIONS`. */
const PAGES: { [K in ReferenceSection]: (session: ReferenceSession, options: PageOptions) => ReferenceReplies[K] } = { profile, people, places, things }

export interface ReferenceDeps {
  sessionsDir(): string
  open(id: string): ReferenceSession
}

/**
 * One page of what the player may look up, built from what the player's character has met, learned or can see.
 * @throws {UnknownSectionError} for a section that does not exist.
 */
export function referencePage<K extends ReferenceSection>(session: ReferenceSession, section: K, options?: PageOptions): ReferenceReply<K>
export function referencePage(session: ReferenceSession, section: string, options?: PageOptions): ReferenceReply
export function referencePage(session: ReferenceSession, section: string, options: PageOptions = {}): ReferenceReply {
  if (!isReferenceSection(section)) throw new UnknownSectionError(`no reference section "${section}"`)
  return { section, entries: PAGES[section](session, options) } as ReferenceReply
}

/** @throws {SessionNotFoundError} when the id names no session. */
export function referenceOfSession(deps: ReferenceDeps, id: string, section: string, options: PageOptions = {}): ReferenceReply {
  if (!isSessionId(id) || !existsSync(sessionDatabase(deps.sessionsDir(), id))) throw new SessionNotFoundError(`no session "${id}"`)
  return referencePage(deps.open(id), section, options)
}
