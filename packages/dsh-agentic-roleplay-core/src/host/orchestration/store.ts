import { changeItem, itemKey, locationKey, planItemChange, applyItemPlan, sessionFolder, type ItemEffect, type RoleplayState, type Session } from 'dsh-roleplay-state'
import { roleplaySessionOf } from '../../shared/chat.ts'
import type { MoveRequest } from './protocol.ts'
import type { ItemChangeSpec } from 'dsh-roleplay-state'
import { liveSettings } from '../sessions/settings.ts'
import type { CastMember, CastPlace, ItemView, MoveCheck, PlaceView, RoundRecord, TurnStore } from './boundaries.ts'

export { roleplaySessionOf }

const keyOfCharacter = (character: { id: number; sourceId?: string }): string => character.sourceId ?? String(character.id)

function placeOf(session: Session, characterId: number): CastPlace | undefined {
  const placement = session.placements.get('character', characterId)
  const location = placement === undefined ? undefined : session.locations.get(placement.locationId)
  if (placement === undefined || location === undefined) return undefined
  const feature = placement.featureKey === undefined ? undefined : location.features.find(candidate => candidate.key === placement.featureKey)
  return { location, position: placement.position, ...(feature === undefined ? {} : { feature }) }
}

function castOf(session: Session): CastMember[] {
  return session.characters.list().map((character) => {
    const state = session.characterStates.get(character.id)
    const place = placeOf(session, character.id)
    return { key: keyOfCharacter(character), character, ...(state === undefined ? {} : { state }), ...(place === undefined ? {} : { place }) }
  })
}

/** How much of what is in a container is told: a bag with fifty things in it is not recited. */
const SHOWN_CONTENTS = 5

function viewOf(session: Session, id: number, where?: string): ItemView | undefined {
  const item = session.items.get(id)
  if (item === undefined) return undefined
  const inside = item.container?.state === 'open' ? session.items.contents({ kind: 'item', id }).filter(entry => !entry.item.hidden).map(entry => (entry.item.quantity > 1 ? `${entry.item.quantity} ${entry.item.name}` : entry.item.name)) : undefined
  return {
    key: itemKey(item), name: item.name, quantity: item.quantity, quality: item.quality, notable: item.notable, hidden: item.hidden,
    ...(item.container === undefined ? {} : { state: item.container.state }),
    ...(inside === undefined || inside.length === 0 ? {} : { contents: [...inside.slice(0, SHOWN_CONTENTS), ...(inside.length > SHOWN_CONTENTS ? [`and ${inside.length - SHOWN_CONTENTS} more`] : [])] }),
    ...(where === undefined || where === '' ? {} : { where }),
  }
}

/** What lies in a place, notable things first; hidden things are included only when asked for. */
function itemsIn(session: Session, locationId: number, withHidden: boolean): ItemView[] {
  return session.items.contents({ kind: 'location', id: locationId })
    .filter(entry => withHidden || !entry.item.hidden)
    .sort((a, b) => Number(b.item.notable) - Number(a.item.notable) || a.item.id - b.item.id)
    .flatMap((entry) => {
      const holder = entry.holding.holder
      const feature = holder.kind === 'location' && holder.featureKey !== undefined ? session.locations.get(locationId)?.features.find(candidate => candidate.key === holder.featureKey)?.name : undefined
      const where = holder.kind === 'location' ? [holder.position, feature === undefined ? undefined : `at ${feature}`].filter(part => part !== undefined && part !== '').join(', ') : ''
      const view = viewOf(session, entry.item.id, where)
      return view === undefined ? [] : [view]
    })
}

function carriedBy(session: Session, characterId: number): ItemView[] {
  return session.items.contents({ kind: 'character', id: characterId })
    .sort((a, b) => Number(b.item.notable) - Number(a.item.notable) || a.item.id - b.item.id)
    .flatMap((entry) => {
      const holder = entry.holding.holder
      const view = viewOf(session, entry.item.id, holder.kind === 'character' && holder.mode === 'worn' ? `worn on the ${holder.slot}` : 'carried')
      return view === undefined ? [] : [view]
    })
}

function placeViewOf(session: Session, locationId: number): PlaceView | undefined {
  const location = session.locations.get(locationId)
  if (location === undefined) return undefined
  const here = new Set(session.placements.at(locationId, 'character').map(placement => placement.entityId))
  return {
    key: locationKey(location),
    location,
    exits: session.locations.exitsFrom(locationId).flatMap((exit) => {
      const to = session.locations.get(exit.toId)
      return to === undefined ? [] : [{ key: locationKey(to), name: to.name, exit }]
    }),
    here: castOf(session).filter(member => here.has(member.character.id)),
    items: itemsIn(session, locationId, false),
  }
}

class DryRunDone extends Error {}

/** Do the changes in order inside a transaction that is always undone, so that a later change sees the earlier ones. */
function dryRunItems(session: Session, entries: readonly { character: string; changes: readonly ItemChangeSpec[] }[]): { ok: true; effects: ItemEffect[][] } | { ok: false; problems: string[] } {
  const problems: string[] = []
  const effects: ItemEffect[][] = []
  try {
    session.transaction(() => {
      for (const entry of entries) {
        const character = session.characters.list().find(candidate => keyOfCharacter(candidate) === entry.character)
        const mine: ItemEffect[] = []
        effects.push(mine)
        if (character === undefined) { problems.push(`${entry.character}: there is no such character`); continue }
        for (const spec of entry.changes) {
          const planned = planItemChange(session, character.id, spec)
          if (!planned.ok) { problems.push(...planned.problems.map(problem => `${entry.character}: cannot ${spec.action} ${spec.item}: ${problem}`)); break }
          mine.push(applyItemPlan(session, planned.plan))
        }
      }
      throw new DryRunDone()
    })
  } catch (error) {
    if (!(error instanceof DryRunDone)) throw error
  }
  return problems.length === 0 ? { ok: true, effects } : { ok: false, problems }
}

function checkMove(session: Session, characterKey: string, request: MoveRequest): MoveCheck {
  const character = session.characters.list().find(candidate => keyOfCharacter(candidate) === characterKey)
  if (character === undefined) return { ok: false, problems: [`there is no character "${characterKey}"`] }
  const to = session.locations.list().find(candidate => locationKey(candidate) === request.location)
  if (to === undefined) return { ok: false, problems: [`there is no place "${request.location}" (list_locations shows the keys)`] }
  const move = { to: to.id, ...(request.position === undefined ? {} : { position: request.position }), ...(request.feature === undefined ? {} : { featureKey: request.feature }), ...(request.ignoreExits === true ? { ignoreExits: true } : {}) }
  const planned = session.planMove(character.id, move)
  return planned.ok
    ? { ok: true, move, plan: planned.plan, to: { key: locationKey(to), name: to.name }, ...(request.position === undefined ? {} : { position: request.position }) }
    : { ok: false, problems: planned.problems }
}

function storeOf(session: Session, folder: string, problem: (message: string) => void, queryVector: TurnStore['queryVector']): TurnStore {
  return {
    story: session,
    cast: () => castOf(session),
    checkMove: (character, request) => checkMove(session, character, request),
    place: locationId => placeViewOf(session, locationId),
    settings: () => liveSettings(folder, problem),
    commit: (updates) => session.transaction(() => updates.map(({ character, patch, move, items }) => {
      session.characterStates.update(character, patch)
      // What a character does with things happens where it is, so before it goes anywhere.
      const effects = (items ?? []).map(spec => changeItem(session, character, spec))
      if (move !== undefined) session.move(character, move)
      return effects
    })),
    checkItemChanges: entries => dryRunItems(session, entries),
    carried: characterId => carriedBy(session, characterId),
    itemsAt: (locationId, withHidden = false) => itemsIn(session, locationId, withHidden),
    completeTurn: () => { session.metadata.recordTurn() },
    queueCommit: record => { session.pendingCommits.enqueue(record.turn, record.round, JSON.parse(JSON.stringify(record)) as never) },
    pendingCommits: () => session.pendingCommits.list().map(entry => entry.payload as unknown as RoundRecord),
    completeCommits: (rounds) => {
      session.transaction(() => {
        session.events.seal()
        session.pendingCommits.complete(rounds)
      })
    },
    queryVector,
  }
}

/** Opens the store of the roleplay session behind a chat; a chat that is not one gets none. */
export function storesOf(
  state: Pick<RoleplayState, 'openSession'>,
  sessionsDir: () => string,
  problem: (message: string) => void = () => undefined,
  /** The vector of a text for a chat's search, from the embedding index; none without one. */
  queryVector: (chat: string, text: string, signal?: AbortSignal) => Promise<readonly number[] | undefined> = () => Promise.resolve(undefined),
): (chat: string) => TurnStore | undefined {
  return (chat) => {
    const id = roleplaySessionOf(chat)
    if (id === undefined) return undefined
    try {
      return storeOf(state.openSession(sessionsDir(), id), sessionFolder(sessionsDir(), id), problem, (text, signal) => queryVector(chat, text, signal))
    } catch {
      return undefined
    }
  }
}
