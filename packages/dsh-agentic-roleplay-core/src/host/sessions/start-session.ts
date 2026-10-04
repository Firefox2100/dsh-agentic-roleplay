import { join } from 'node:path'
import { sessionFolder, type RoleplayState } from 'dsh-roleplay-state'
import type { StartedSession, StartSessionRequest } from '../../shared/sessions.ts'
import type { WorldProblem } from '../../shared/worlds.ts'
import type { NarrationSegment } from '../../shared/narration.ts'
import { loadCharacters } from '../characters/load.ts'
import { loadLocations } from '../locations/load.ts'
import type { AgentSessions } from '../agent/agent-sessions.ts'
import type { WorldCatalog } from '../worlds/catalog.ts'
import { WORLD_FILE_NAME, type OpeningSegment } from '../worlds/world-file.ts'
import { parseSettings } from '../../shared/settings.ts'
import { writeSettings } from './settings.ts'
import { InvalidStartError, InvalidWorldError, WorldNotFoundError } from './errors.ts'
import { populateCharacters, populateLocations, startingPlaceProblems } from './populate.ts'

const MAX_NAME_LENGTH = 200

export interface StartSessionDeps {
  worlds: Pick<WorldCatalog, 'find'>
  state: Pick<RoleplayState, 'createSession' | 'deleteSession'>
  agent: Pick<AgentSessions, 'ensure' | 'retire'>
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

  const { locations, problems: locationProblems } = await loadLocations(world.directory)
  if (locationProblems.length > 0) throw new InvalidWorldError(`the places of "${world.summary.name}" have ${locationProblems.length} problem(s)`, locationProblems)
  const placing = startingPlaceProblems(characters, locations)
  if (placing.length > 0) throw new InvalidWorldError(`the starting places of "${world.summary.name}" have ${placing.length} problem(s)`, placing.map(message => ({ path: world.directory, message })))

  const opening = openingOf(world, characters)
  const player = characters.find(character => character.id === request.playerCharacterId)
  if (player === undefined) throw new InvalidStartError(`"${world.summary.name}" has no character "${request.playerCharacterId}"`)
  if (player.role !== 'playable') throw new InvalidStartError(`${player.name} cannot be played`)
  const name = request.name?.trim() || world.summary.name
  if (name.length > MAX_NAME_LENGTH) throw new InvalidStartError(`the name must be at most ${MAX_NAME_LENGTH} characters`)

  if (request.settings !== undefined) {
    const settings = parseSettings(request.settings)
    if (!settings.ok) throw new InvalidStartError(`the settings are not acceptable: ${settings.problems.join('; ')}`)
  }

  const sessionsDir = deps.sessionsDir()
  const session = deps.state.createSession(sessionsDir, {
    name,
    world: { id: world.summary.id, name: world.summary.name, source: `worlds/${world.folder}` },
  })
  const { id } = session.metadata.get()
  let chatSessionId: string
  try {
    session.transaction(() => {
      populateLocations(session, locations)
      populateCharacters(session, characters, player.id)
    })
    if (request.settings !== undefined) writeSettings(sessionFolder(sessionsDir, id), request.settings)
    chatSessionId = await deps.agent.ensure(id, name, opening)
  } catch (error) {
    deps.state.deleteSession(sessionsDir, id)
    // The chat may have been made before the failure; a chat with no session behind it is not wanted.
    await deps.agent.retire(id).catch(() => undefined)
    throw error
  }
  return { id, chatSessionId, name, worldId: world.summary.id, worldName: world.summary.name, characterCount: characters.length }
}

/** The opening of the world with each speaker's name, or the reason it cannot be used. */
function openingOf(world: { directory: string; summary: { name: string }; opening?: readonly OpeningSegment[] }, characters: readonly { id: string; name: string }[]): NarrationSegment[] | undefined {
  if (world.opening === undefined) return undefined
  const problems: WorldProblem[] = []
  const segments = world.opening.map((segment): NarrationSegment => {
    if (segment.type === 'narration') return segment
    const speaker = characters.find(character => character.id === segment.character)
    if (speaker === undefined) problems.push({ path: join(world.directory, WORLD_FILE_NAME), message: `opening_message: "${segment.character}" is not a character of this world` })
    return { type: 'utterance', character: segment.character, name: speaker?.name ?? segment.character, text: segment.text }
  })
  if (problems.length > 0) throw new InvalidWorldError(`the opening of "${world.summary.name}" has ${problems.length} problem(s)`, problems)
  return segments
}
