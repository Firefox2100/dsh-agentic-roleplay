import { existsSync } from 'node:fs'
import { isSessionId, sessionDatabase, sessionFolder, type RoleplayState, type Session } from '@dsh-agentic-roleplay/state'
import type { StoryComparison } from '../../shared/compare.ts'
import { START_SNAPSHOT, snapshotOf } from '../../shared/timeline.ts'
import { readTimeline } from '../timeline/file.ts'
import { compareStates, type StateSide } from '../timeline/compare.ts'
import { SessionNotFoundError } from './errors.ts'

export class UnknownStateError extends Error {}

export interface CompareDeps {
  state: Pick<RoleplayState, 'openSession' | 'snapshots' | 'readSnapshot'>
  sessionsDir: () => string
}

/** The head of the story: the state it is in now. */
export const HEAD = 'head'

const sideOf = (label: string, store: Session): StateSide => ({ label, turns: store.metadata.get().turns, now: ((now) => (now === undefined ? undefined : new Date(now).toISOString()))(store.clock.get()?.now), view: store.records() })

/**
 * What differs between two states of a story: `head` (as it is now), `start` (before the first turn) or a turn of the timeline, whose kept state is read. Turns
 * whose state was not kept (older than the setting allows, unless named as a checkpoint) cannot be compared.
 * @throws {SessionNotFoundError} when the id names no session. @throws {UnknownStateError} when a side names no turn, or one whose state is not kept.
 */
export function compareSession(deps: CompareDeps, id: string, first: string, second: string): StoryComparison {
  const directory = deps.sessionsDir()
  if (!isSessionId(id) || !existsSync(sessionDatabase(directory, id))) throw new SessionNotFoundError(`no session "${id}"`)
  const timeline = readTimeline(sessionFolder(directory, id))
  const kept = new Set(deps.state.snapshots(directory, id))
  const label = (at: string): string => {
    if (at === HEAD) return 'now'
    if (at === START_SNAPSHOT) return 'the start'
    const node = timeline.nodes.find(candidate => candidate.id === at)
    if (node === undefined) throw new UnknownStateError(`there is no turn "${at}"`)
    return node.label === undefined ? `turn ${node.turn}` : `“${node.label}” (turn ${node.turn})`
  }
  const side = (at: string): StateSide => {
    const name = label(at)
    if (at === HEAD) return sideOf(name, deps.state.openSession(directory, id))
    const snapshot = at === START_SNAPSHOT ? START_SNAPSHOT : snapshotOf(at)
    if (!kept.has(snapshot)) throw new UnknownStateError(`the state after ${name} is not kept: name the turn as a checkpoint to keep it`)
    return deps.state.readSnapshot(directory, id, snapshot, store => sideOf(name, store))
  }
  return compareStates(side(first), side(second))
}
