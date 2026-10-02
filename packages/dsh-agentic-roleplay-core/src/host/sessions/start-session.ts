import type { RoleplayState } from 'dsh-roleplay-state'
import type { StartedSession, StartSessionRequest } from '../../shared/sessions.ts'
import { loadCharacters } from '../characters/load.ts'
import type { AgentSessions } from '../agent/agent-sessions.ts'
import type { WorldCatalog } from '../worlds/catalog.ts'
import { InvalidStartError, InvalidWorldError, WorldNotFoundError } from './errors.ts'
import { populateCharacters } from './populate.ts'

const MAX_NAME_LENGTH = 200

export interface StartSessionDeps {
  worlds: Pick<WorldCatalog, 'find'>
  state: Pick<RoleplayState, 'createSession' | 'deleteSession'>
  agent: Pick<AgentSessions, 'ensure'>
  /** Read for each session, because the roleplay root can move. */
  sessionsDir: () => string
}

/**
 * Start a new session for a world: create its folder and database and fill it
 * from the world. Either the whole session exists afterwards or nothing does.
 * @throws {WorldNotFoundError} when no world has that id.
 * @throws {InvalidWorldError} when the world's characters cannot be read.
 * @throws {InvalidStartError} when the name or the player's character is not acceptable.
 * @throws {AgentUnavailableError} when the chat cannot be created.
 */
export async function startSession(deps: StartSessionDeps, request: StartSessionRequest): Promise<StartedSession> {
  const world = await deps.worlds.find(request.worldId)
  if (world === undefined) throw new WorldNotFoundError(`there is no world with id "${request.worldId}"`)

  const { characters, problems } = await loadCharacters(world.directory)
  if (problems.length > 0) throw new InvalidWorldError(`the characters of "${world.summary.name}" have ${problems.length} problem(s)`, problems)

  const player = characters.find(character => character.id === request.playerCharacterId)
  if (player === undefined) throw new InvalidStartError(`"${world.summary.name}" has no character "${request.playerCharacterId}"`)
  if (player.role !== 'playable') throw new InvalidStartError(`${player.name} cannot be played`)
  const name = request.name?.trim() || world.summary.name
  if (name.length > MAX_NAME_LENGTH) throw new InvalidStartError(`the name must be at most ${MAX_NAME_LENGTH} characters`)

  const sessionsDir = deps.sessionsDir()
  const session = deps.state.createSession(sessionsDir, {
    name,
    world: { id: world.summary.id, name: world.summary.name, source: `worlds/${world.folder}` },
  })
  const { id } = session.metadata.get()
  let chatSessionId: string
  try {
    session.transaction(() => { populateCharacters(session, characters, player.id) })
    chatSessionId = await deps.agent.ensure(id)
  } catch (error) {
    deps.state.deleteSession(sessionsDir, id)
    throw error
  }
  return { id, chatSessionId, name, worldId: world.summary.id, worldName: world.summary.name, characterCount: characters.length }
}
