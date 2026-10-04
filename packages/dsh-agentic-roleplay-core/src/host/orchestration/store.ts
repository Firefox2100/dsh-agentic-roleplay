import { locationKey, sessionFolder, type RoleplayState, type Session } from 'dsh-roleplay-state'
import { roleplaySessionOf } from '../../shared/chat.ts'
import type { MoveRequest } from './protocol.ts'
import { liveSettings } from '../sessions/settings.ts'
import type { CastMember, CastPlace, MoveCheck, PlaceView, RoundRecord, TurnStore } from './boundaries.ts'

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
  }
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
    commit: (updates) => {
      session.transaction(() => {
        for (const { character, patch, move } of updates) {
          session.characterStates.update(character, patch)
          if (move !== undefined) session.move(character, move)
        }
      })
    },
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
