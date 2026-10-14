import { join } from 'node:path'
import { lintWorld, parseInstant, sessionFolder, systemTimeZone, type RoleplayState } from '@dsh-agentic-roleplay/state'
import type { CharacterDefinition } from 'dsh-roleplay-model'
import type { StartedSession, StartSessionRequest } from '../../shared/sessions.ts'
import type { WorldProblem } from '../../shared/worlds.ts'
import type { NarrationSegment } from '../../shared/narration.ts'
import { addToNote } from './notes.ts'
import { populatePlots } from '../pacing/director.ts'
import type { AgentSessions } from '../agent/agent-sessions.ts'
import type { WorldCatalog } from '../worlds/catalog.ts'
import { WORLD_FILE_NAME, type OpeningSegment } from '../worlds/world-file.ts'
import { DEFAULT_SETTINGS, parseSettings, type ChatSettings } from '../../shared/settings.ts'
import { WORLD_RULES_KEY } from '../../shared/rules.ts'
import { writeSettings } from './settings.ts'
import { InvalidStartError, InvalidWorldError, WorldNotFoundError } from './errors.ts'
import { populateCharacters, populateClock, populateFactions, populateItems, populateKnowledge, populateLocations, populateLore, populateRoutines, populateTriggers, populateVariables } from './populate.ts'
import { inheritImages } from '../images/storage.ts'
import { copyWorldPrompts } from '../prompts/library.ts'
import { copyWorldPacks } from '../interface/packs.ts'
import { broughtAvatars, copyPortrait } from '../avatars/avatars.ts'
import { parseCharacterFile } from '../characters/character-file.ts'
import type { EditableWorld } from '../worlds/world-editor.ts'
import { loadValidatedWorld } from '../worlds/validated-world.ts'

export const MAX_NAME_LENGTH = 200

export interface StartSessionDeps {
  worlds: Pick<WorldCatalog, 'find'>
  state: Pick<RoleplayState, 'createSession' | 'deleteSession'>
  agent: Pick<AgentSessions, 'ensure' | 'retire'>
  /** The player avatars, when there are any to bring along. */
  avatars?: () => Promise<EditableWorld>
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
/** What is unfinished in the world as it was started, errors first, for the player's card before the first message. */
function worldFindings(session: Parameters<typeof lintWorld>[0]): string[] {
  const rank = { error: 0, warning: 1, info: 2 } as const
  return lintWorld(session).filter(finding => finding.severity !== 'info').sort((a, b) => rank[a.severity] - rank[b.severity]).map(finding => finding.message)
}

export async function startSession(deps: StartSessionDeps, request: StartSessionRequest): Promise<StartedSession> {
  const world = await deps.worlds.find(request.worldId)
  if (world === undefined) throw new WorldNotFoundError(`there is no world with id "${request.worldId}"`)

  const { characters: authored, factions, locations, items, slots, authoredLore, declared, scripted, authoredPlots } = await loadValidatedWorld(world)


  if (request.opening !== undefined && (!Number.isInteger(request.opening) || request.opening < 0 || request.opening >= (world.alternateOpenings?.length ?? 0))) throw new InvalidStartError(`the world has no alternate opening ${String(request.opening)}`)
  const opening = request.opening === undefined ? openingOf(world, authored) : [{ type: 'narration' as const, text: world.alternateOpenings![request.opening]!.text }]
  const keys = [...new Set(request.avatars ?? [])]
  if (keys.length > 0 && deps.avatars === undefined) throw new InvalidStartError('player avatars are not available')
  const avatars = keys.length === 0 ? undefined : await deps.avatars!()
  const brought = avatars === undefined ? [] : await broughtAvatars(avatars, keys, authored, locations)
  const characters = [...authored, ...brought.map(entry => (parseCharacterFile(JSON.stringify(entry.document), entry.id) as { value: CharacterDefinition }).value)]
  if ((request.playerCharacterId === undefined) === (request.playerAvatar === undefined)) throw new InvalidStartError('name the character the player takes: one of the world\'s or one of the avatars')
  const playerId = request.playerAvatar === undefined ? request.playerCharacterId : brought.find(entry => entry.from === request.playerAvatar)?.id
  const player = characters.find(character => character.id === playerId)
  if (player === undefined) throw new InvalidStartError(request.playerAvatar === undefined ? `"${world.summary.name}" has no character "${request.playerCharacterId}"` : `the avatar "${request.playerAvatar}" is not among the avatars brought along`)
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

  let startsAt = world.clock?.startingTime
  if (request.startingTime !== undefined && request.startingTime.trim() !== '') {
    if (settings.clock.mode === 'real') throw new InvalidStartError('the story\'s time follows the wall clock, so it has no starting time to choose')
    try { startsAt = parseInstant(request.startingTime.trim(), timeZone) } catch (error) { throw new InvalidStartError(`the starting time is not acceptable: ${error instanceof Error ? error.message : String(error)}`) }
  }

  const sessionsDir = deps.sessionsDir()
  const session = deps.state.createSession(sessionsDir, {
    name,
    world: { id: world.summary.id, name: world.summary.name, ...(world.summary.version === undefined ? {} : { version: world.summary.version }), source: `worlds/${world.folder}` },
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
      populateClock(session, settings.clock, startsAt === undefined ? undefined : { startingTime: startsAt }, (deps.now ?? Date.now)())
      if (world.rules !== undefined) session.metadata.setValue(WORLD_RULES_KEY, world.rules)
      if (world.narrationVoice !== undefined) session.metadata.setValue('roleplay.tts.narrationVoice', world.narrationVoice)
    })
    await inheritImages(world.directory, sessionFolder(sessionsDir, id), [])
    if (avatars !== undefined) for (const entry of brought) await copyPortrait(avatars, entry.from, entry.document, sessionFolder(sessionsDir, id), entry.id)
    const promptProblems = copyWorldPrompts(world.directory, sessionFolder(sessionsDir, id))
    if (promptProblems.length > 0) throw new InvalidWorldError(`the prompts of "${world.summary.name}" have ${promptProblems.length} problem(s)`, promptProblems)
    const packProblems = copyWorldPacks(world.directory, sessionFolder(sessionsDir, id))
    if (packProblems.length > 0) throw new InvalidWorldError(`the interface packs of "${world.summary.name}" have ${packProblems.length} problem(s)`, packProblems)
    writeSettings(sessionFolder(sessionsDir, id), settings)
    addToNote(session, 'world', 1, worldFindings(session))
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
