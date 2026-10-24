import { existsSync } from 'node:fs'
import type { DecisionService } from '@dsh-ai-providers/core'
import { isSessionId, sessionDatabase, sessionFolder } from '@dsh-agentic-roleplay/state'
import type { DecisionsPayload } from '../../shared/decisions.ts'
import { SessionNotFoundError } from '../sessions/errors.ts'
import { readDecisionStats } from './stats.ts'

/**
 * Whether a decision service is there, which one, and what was kept about how the story's decisions went.
 * @throws {SessionNotFoundError} for an id that names no session.
 */
export function decisionsOfSession(deps: { sessionsDir: () => string; service: () => DecisionService | undefined }, id: string): DecisionsPayload {
  const sessions = deps.sessionsDir()
  if (!isSessionId(id) || !existsSync(sessionDatabase(sessions, id))) throw new SessionNotFoundError(`no session "${id}"`)
  const service = deps.service()
  return { available: service !== undefined, ...service === undefined ? {} : { provider: service.provider, model: service.model }, stats: readDecisionStats(sessionFolder(sessions, id)) }
}
