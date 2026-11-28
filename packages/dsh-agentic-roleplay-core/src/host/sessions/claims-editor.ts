import { readClaims, type ClaimStatus } from '@dsh-agentic-roleplay/state'
import { isSessionId, sessionDatabase } from '@dsh-agentic-roleplay/state'
import { existsSync } from 'node:fs'
import type { WorldStateDeps } from './world-state.ts'
import { SessionNotFoundError } from './errors.ts'
import type { EditorClaim, EditorClaims } from '../../shared/claims.ts'

function sessionOf(deps: WorldStateDeps, id: string) {
  const directory = deps.sessionsDir()
  if (!isSessionId(id) || !existsSync(sessionDatabase(directory, id))) throw new SessionNotFoundError(`no session "${id}"`)
  return deps.state.openSession(directory, id)
}

/** Every claim of a story, proposed ones first, for the person who settles them. @throws {SessionNotFoundError} */
export function readSessionClaims(deps: WorldStateDeps, id: string): EditorClaims {
  const session = sessionOf(deps, id)
  const textOf = (eventId: number): string => session.events.get(eventId)?.text ?? ''
  const claims = readClaims(session).map(({ claim, verdict }): EditorClaim => ({
    id: claim.id,
    text: claim.text,
    by: claim.byCharacterId !== undefined ? session.characters.get(claim.byCharacterId)?.name ?? null : claim.byLabel === '' ? null : claim.byLabel,
    assertedIn: claim.assertedEventId === undefined ? null : { id: claim.assertedEventId, text: textOf(claim.assertedEventId) },
    status: claim.status,
    verdict,
    parts: claim.parts,
    links: claim.links.map(link => ({ event: link.eventId, text: textOf(link.eventId), as: link.bearing, part: link.part })),
    turn: claim.createdTurn,
  }))
  claims.sort((a, b) => Number(b.status === 'proposed') - Number(a.status === 'proposed') || b.id - a.id)
  return { claims, questions: session.claims.questions() }
}

/** @throws {SessionNotFoundError} @throws {ClaimNotFoundError} */
export function setSessionClaimStatus(deps: WorldStateDeps, id: string, claim: number, status: ClaimStatus): EditorClaims {
  const session = sessionOf(deps, id)
  if (session.claims.get(claim) === undefined) throw new ClaimNotFoundError(`no claim ${claim}`)
  session.claims.setStatus(claim, status)
  return readSessionClaims(deps, id)
}

/** @throws {SessionNotFoundError} @throws {ClaimNotFoundError} */
export function removeSessionClaim(deps: WorldStateDeps, id: string, claim: number): EditorClaims {
  const session = sessionOf(deps, id)
  if (!session.claims.remove(claim)) throw new ClaimNotFoundError(`no claim ${claim}`)
  return readSessionClaims(deps, id)
}

export class ClaimNotFoundError extends Error {}
