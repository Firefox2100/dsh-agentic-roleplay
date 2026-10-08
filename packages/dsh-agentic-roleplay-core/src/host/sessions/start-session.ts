import { join } from 'node:path'
import { sessionFolder, systemTimeZone, type RoleplayState } from 'dsh-roleplay-state'
import type { StartedSession, StartSessionRequest } from '../../shared/sessions.ts'
import type { WorldProblem } from '../../shared/worlds.ts'
import type { NarrationSegment } from '../../shared/narration.ts'
import { loadCharacters } from '../characters/load.ts'
import { loadFactions } from '../factions/load.ts'
import { loadItems } from '../items/load.ts'
import { loadLocations } from '../locations/load.ts'
import { loadLore } from '../lore/load.ts'
import { loadTriggers } from '../triggers/load.ts'
import { loadPlots, plotReferenceProblems } from '../plots/load.ts'
import { populatePlots } from '../pacing/director.ts'
import { loadVariables, variableProblems } from '../variables/load.ts'
import type { AgentSessions } from '../agent/agent-sessions.ts'
import type { WorldCatalog } from '../worlds/catalog.ts'
import { WORLD_FILE_NAME, type OpeningSegment } from '../worlds/world-file.ts'
import { DEFAULT_SETTINGS, parseSettings, type ChatSettings } from '../../shared/settings.ts'
import { WORLD_RULES_KEY } from '../../shared/rules.ts'
import { writeSettings } from './settings.ts'
import { InvalidStartError, InvalidWorldError, WorldNotFoundError } from './errors.ts'
import { factionProblems, knowledgeProblems, loreProblems, populateCharacters, populateClock, populateFactions, populateItems, populateKnowledge, populateLocations, populateLore, populateRoutines, populateTriggers, populateVariables, relationshipProblems, routineProblems, startingPlaceProblems } from './populate.ts'
import { inheritImages } from '../images/storage.ts'

export const MAX_NAME_LENGTH = 200

export interface StartSessionDeps {
  worlds: Pick<WorldCatalog, 'find'>
  state: Pick<RoleplayState, 'createSession' | 'deleteSession'>
  agent: Pick<AgentSessions, 'ensure' | 'retire'>
  /** Read for each session, because the roleplay root can move. */
  sessionsDir: () => string
  /** The wall clock, in UTC milliseconds. */
  now?: () => number
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

  const { factions, problems: factionFileProblems } = await loadFactions(world.directory)
  if (factionFileProblems.length > 0) throw new InvalidWorldError(`the factions of "${world.summary.name}" have ${factionFileProblems.length} problem(s)`, factionFileProblems)
  const factionReferences = factionProblems(factions, characters)
  if (factionReferences.length > 0) throw new InvalidWorldError(`the factions of "${world.summary.name}" have ${factionReferences.length} problem(s)`, factionReferences.map(message => ({ path: world.directory, message })))

  const { locations, problems: locationProblems } = await loadLocations(world.directory)
  if (locationProblems.length > 0) throw new InvalidWorldError(`the places of "${world.summary.name}" have ${locationProblems.length} problem(s)`, locationProblems)
  const placing = startingPlaceProblems(characters, locations)
  if (placing.length > 0) throw new InvalidWorldError(`the starting places of "${world.summary.name}" have ${placing.length} problem(s)`, placing.map(message => ({ path: world.directory, message })))

  const days = routineProblems(characters, locations)
  if (days.length > 0) throw new InvalidWorldError(`the days of the characters of "${world.summary.name}" have ${days.length} problem(s)`, days.map(message => ({ path: world.directory, message })))

  const { items, slots, problems: itemProblems } = await loadItems(world.directory, { characters: characters.map(character => character.id), locations })
  if (itemProblems.length > 0) throw new InvalidWorldError(`the items of "${world.summary.name}" have ${itemProblems.length} problem(s)`, itemProblems)
  const authoredLore = await loadLore(world.directory)
  if (authoredLore.problems.length > 0) throw new InvalidWorldError(`the lore of "${world.summary.name}" has ${authoredLore.problems.length} problem(s)`, authoredLore.problems)
  const loreReferences = loreProblems(authoredLore.lore, { characters, factions, locations, items })
  if (loreReferences.length > 0) throw new InvalidWorldError(`the lore of "${world.summary.name}" has ${loreReferences.length} invalid reference(s)`, loreReferences.map(message => ({ path: world.directory, message })))
  const knowing = knowledgeProblems(characters, locations, items, authoredLore.lore)
  if (knowing.length > 0) throw new InvalidWorldError(`the starting knowledge of "${world.summary.name}" has ${knowing.length} problem(s)`, knowing.map(message => ({ path: world.directory, message })))

  const declared = await loadVariables(world.directory)
  if (declared.problems.length > 0) throw new InvalidWorldError(`the variables of "${world.summary.name}" have ${declared.problems.length} problem(s)`, declared.problems)
  const tracking = variableProblems({ defs: declared.defs, characters, items, locations, values: world.variables })
  if (tracking.length > 0) throw new InvalidWorldError(`what "${world.summary.name}" tracks has ${tracking.length} problem(s)`, tracking.map(message => ({ path: world.directory, message })))

  const scripted = await loadTriggers(world.directory)
  if (scripted.problems.length > 0) throw new InvalidWorldError(`the triggers of "${world.summary.name}" have ${scripted.problems.length} problem(s)`, scripted.problems)
  const authoredPlots = await loadPlots(world.directory)
  if (authoredPlots.problems.length > 0) throw new InvalidWorldError(`the plots of "${world.summary.name}" have ${authoredPlots.problems.length} problem(s)`, authoredPlots.problems)
  const plotReferences = plotReferenceProblems(authoredPlots.plots, [...characters.map(entry => entry.id), ...factions.map(entry => entry.id), ...locations.map(entry => entry.id), ...items.map(entry => entry.id), ...authoredLore.lore.map(entry => entry.id)])
  if (plotReferences.length > 0) throw new InvalidWorldError(`the plots of "${world.summary.name}" have ${plotReferences.length} invalid participant(s)`, plotReferences.map(message => ({ path: world.directory, message })))

  const related = relationshipProblems(characters)
  if (related.length > 0) throw new InvalidWorldError(`the relationships of "${world.summary.name}" have ${related.length} problem(s)`, related.map(message => ({ path: world.directory, message })))

  const opening = openingOf(world, characters)
  const player = characters.find(character => character.id === request.playerCharacterId)
  if (player === undefined) throw new InvalidStartError(`"${world.summary.name}" has no character "${request.playerCharacterId}"`)
  if (player.role !== 'playable') throw new InvalidStartError(`${player.name} cannot be played`)
  const name = request.name?.trim() || world.summary.name
  if (name.length > MAX_NAME_LENGTH) throw new InvalidStartError(`the name must be at most ${MAX_NAME_LENGTH} characters`)

  let settings: ChatSettings = DEFAULT_SETTINGS
  if (request.settings !== undefined) {
    const parsed = parseSettings(request.settings)
    if (!parsed.ok) throw new InvalidStartError(`the settings are not acceptable: ${parsed.problems.join('; ')}`)
    settings = parsed.value
  }
  // The zone a story is read in is chosen once, here: the zone of the computer when time follows the wall clock, otherwise the world's.
  const timeZone = settings.clock.timeZone !== '' ? settings.clock.timeZone : settings.clock.mode === 'real' ? systemTimeZone() : world.clock?.timeZone ?? 'UTC'
  settings = { ...settings, clock: { ...settings.clock, timeZone } }

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
      populateFactions(session, factions)
      populateRoutines(session, characters)
      populateItems(session, items, slots, locations)
      populateLore(session, authoredLore.lore)
      populateKnowledge(session, characters)
      populateVariables(session, declared.defs, { characters, items, locations, values: world.variables })
      populateTriggers(session, scripted.triggers)
      populatePlots(session.metadata, authoredPlots.plots)
      populateClock(session, settings.clock, world.clock, (deps.now ?? Date.now)())
      if (world.rules !== undefined) session.metadata.setValue(WORLD_RULES_KEY, world.rules)
      if (world.narrationVoice !== undefined) session.metadata.setValue('roleplay.tts.narrationVoice', world.narrationVoice)
    })
    await inheritImages(world.directory, sessionFolder(sessionsDir, id), [])
    writeSettings(sessionFolder(sessionsDir, id), settings)
    chatSessionId = await deps.agent.ensure(id, name, opening)
  } catch (error) {
    deps.state.deleteSession(sessionsDir, id)
    // The chat may have been made before the failure; a chat with no session behind it is not wanted.
    await deps.agent.retire(id).catch(() => undefined)
    throw error
  }
  return { id, chatSessionId, name, worldId: world.summary.id, worldName: world.summary.name, characterCount: characters.length }
}

/** What a story opens with when its world gives no opening: a chat with nothing in it is DSH's start screen, which has none of the story's tabs. */
const DEFAULT_OPENING = 'The story begins.'

/** The opening of the world with each speaker's name, or the reason it cannot be used. */
function openingOf(world: { directory: string; summary: { name: string }; opening?: readonly OpeningSegment[] }, characters: readonly { id: string; name: string }[]): NarrationSegment[] | undefined {
  if (world.opening === undefined) return [{ type: 'narration', text: DEFAULT_OPENING }]
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
