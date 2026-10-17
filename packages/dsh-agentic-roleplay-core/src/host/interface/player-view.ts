import { createHash } from 'node:crypto'
import { addLocalDays, describeInstant, describeValue, holidaysOn, itemKey, locationKey, readCalendar, seasonOf, shownVariables, type Session, type ShownVariable } from '@dsh-agentic-roleplay/state'
import { PACK_API, type PlayerView } from '../../shared/interface-pack.ts'
import { readNotes } from '../sessions/notes.ts'

export type ViewSession = Pick<Session, 'characters' | 'characterStates' | 'placements' | 'locations' | 'items' | 'knowledge' | 'variables' | 'clock' | 'metadata'>

export interface ViewOptions {
  /** The zone the story is read in. */
  zone: string
  /** The wall clock, in UTC milliseconds. */
  wall: number
}

const keyOf = (character: { id: number; sourceId?: string }): string => character.sourceId ?? String(character.id)

/** What a variable shows, in one line of data. */
function shown(subject: string, entries: readonly ShownVariable[]): PlayerView['variables'] {
  return entries.map(({ variable, value }) => ({ subject, name: variable.name, value: describeValue(variable, value) }))
}

/**
 * What the player may know of the story, for an interface pack to show. It is built field by field from what a person at the
 * player's character's side could see: nothing private, hidden or unknown is read, so nothing of it can leave through here.
 */
export function playerViewOf(session: ViewSession, options: ViewOptions): PlayerView {
  const metadata = session.metadata.get()
  const player = session.characters.list().find(character => character.control === 'player')
  const view: Omit<PlayerView, 'revision'> = {
    api: PACK_API,
    story: { name: metadata.name, turn: metadata.turns },
    map: { places: [], routes: [] },
    carried: [],
    variables: [],
    suggestions: [],
  }
  const clock = session.clock.get()
  if (clock !== undefined) {
    const now = clock.mode === 'real' ? options.wall : clock.now
    const calendar = readCalendar(session.metadata)
    const day = addLocalDays(now, options.zone, 0)
    view.time = { iso: new Date(now).toISOString(), zone: options.zone, text: describeInstant(now, options.zone), season: seasonOf(day, calendar.hemisphere), holidays: holidaysOn(calendar, day).map(holiday => holiday.name) }
  }
  view.variables.push(...shown('the world', shownVariables(session, 'world', 0, 'world', 'others')))
  if (player === undefined) return finish(view, session)
  const playerState = session.characterStates.get(player.id)
  view.player = { key: keyOf(player), name: player.name, summary: player.summary, publicState: playerState?.publicState ?? '' }
  view.variables.push(...shown(player.name, shownVariables(session, 'character', player.id, keyOf(player), 'others')))

  const placement = session.placements.get('character', player.id)
  const here = placement === undefined ? undefined : session.locations.get(placement.locationId)
  const known = new Set(session.knowledge.list(player.id, 'location').map(entry => entry.subjectId))
  if (here !== undefined) {
    known.add(here.id)
    view.place = {
      key: locationKey(here),
      name: here.name,
      description: here.description,
      features: here.features.map(feature => ({ key: feature.key, name: feature.name })),
      exits: session.locations.exitsFrom(here.id).flatMap((exit) => {
        const to = known.has(exit.toId) ? session.locations.get(exit.toId) : undefined
        return to === undefined ? [] : [{ name: to.name, open: exit.state === 'open' }]
      }),
      items: session.items.contents({ kind: 'location', id: here.id }).filter(entry => !entry.item.hidden).map(entry => ({ name: entry.item.name, quantity: entry.item.quantity })),
      here: session.placements.at(here.id, 'character').flatMap((other) => {
        const character = other.entityId === player.id ? undefined : session.characters.get(other.entityId)
        return character === undefined ? [] : [{ key: keyOf(character), name: character.name, publicState: session.characterStates.get(character.id)?.publicState ?? '' }]
      }),
    }
    view.variables.push(...shown(here.name, shownVariables(session, 'location', here.id, locationKey(here), 'others')))
    for (const other of view.place.here) {
      const character = session.characters.list().find(candidate => keyOf(candidate) === other.key)
      if (character !== undefined) view.variables.push(...shown(character.name, shownVariables(session, 'character', character.id, other.key, 'others')))
    }
    for (const entry of session.items.contents({ kind: 'location', id: here.id }).filter(candidate => !candidate.item.hidden)) {
      view.variables.push(...shown(entry.item.name, shownVariables(session, 'item', entry.item.id, itemKey(entry.item), 'others')))
    }
  }
  view.carried = session.items.contents({ kind: 'character', id: player.id }).filter(entry => !entry.item.hidden).map((entry) => {
    const holder = entry.holding.holder
    return { name: entry.item.name, quantity: entry.item.quantity, where: holder.kind === 'character' && holder.mode === 'worn' ? `worn on the ${holder.slot}` : 'carried' }
  })
  const places = [...known].flatMap((id) => { const place = session.locations.get(id); return place === undefined ? [] : [place] })
  view.map.places = places.map(place => ({
    key: locationKey(place),
    name: place.name,
    ...(parentKey(session, place.parentId, known) === undefined ? {} : { parent: parentKey(session, place.parentId, known) as string }),
    here: place.id === here?.id,
  }))
  const exits = session.locations.allExits()
  view.map.routes = session.knowledge.list(player.id, 'exit').flatMap((entry) => {
    const exit = exits.find(candidate => candidate.id === entry.subjectId)
    const from = exit === undefined ? undefined : session.locations.get(exit.fromId)
    const to = exit === undefined ? undefined : session.locations.get(exit.toId)
    return from === undefined || to === undefined || !known.has(from.id) || !known.has(to.id) ? [] : [{ from: locationKey(from), to: locationKey(to) }]
  })
  return finish(view, session)
}

function parentKey(session: Pick<Session, 'locations'>, parentId: number | undefined, known: ReadonlySet<number>): string | undefined {
  const parent = parentId === undefined || !known.has(parentId) ? undefined : session.locations.get(parentId)
  return parent === undefined ? undefined : locationKey(parent)
}

function finish(view: Omit<PlayerView, 'revision'>, session: Pick<Session, 'metadata'>): PlayerView {
  view.suggestions = readNotes(session).find(note => note.kind === 'suggestions')?.lines ?? []
  const revision = createHash('sha256').update(JSON.stringify(view)).digest('hex').slice(0, 16)
  return { ...view, revision }
}
