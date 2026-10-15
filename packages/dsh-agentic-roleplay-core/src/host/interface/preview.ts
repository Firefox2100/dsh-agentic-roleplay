import { createSessionStore, type Session } from '@dsh-agentic-roleplay/state'
import { PACK_API, type PlayerView } from '../../shared/interface-pack.ts'
import { observeAsPlayer } from '../orchestration/observation.ts'
import { populateCharacters, populateClock, populateItems, populateKnowledge, populateLocations, populateVariables } from '../sessions/populate.ts'
import { DEFAULT_SETTINGS } from '../../shared/settings.ts'
import { loadWorldParts } from '../triggers/parts.ts'
import type { WorldRecord } from '../worlds/scan.ts'
import { playerViewOf } from './player-view.ts'

/** What a story shows for suggestions when a pack is looked at before any story exists. */
const SAMPLE_SUGGESTIONS = ['Look around.', 'Ask someone here what they know.', 'Try the nearest door.']

/**
 * What a story of this world would show a pack at its start, from the world's files: a story made in memory, the player taking the first
 * playable character, who then looks around as they do at the start of a turn. Nothing is stored.
 * @throws {InvalidEditProblems} when the rest of the world has problems of its own.
 */
export async function previewViewOf(world: Pick<WorldRecord, 'directory' | 'summary' | 'clock' | 'variables'>, wall: number): Promise<PlayerView> {
  const parts = await loadWorldParts(world.directory)
  const player = parts.characters.find(character => character.role === 'playable') ?? parts.characters[0]
  const scratch = createSessionStore(':memory:', { id: 'preview', name: world.summary.name, world: { id: world.summary.id, name: world.summary.name } }, { vectors: false })
  try {
    // The populate functions use only the repositories, which a store has; the search a session adds is not needed.
    const session = scratch as unknown as Session
    populateLocations(session, parts.locations)
    populateCharacters(session, parts.characters, player?.id ?? '')
    populateItems(session, parts.items, parts.slots, parts.locations)
    populateKnowledge(session, parts.characters)
    populateVariables(session, parts.variables, { characters: parts.characters, items: parts.items, locations: parts.locations, values: world.variables })
    populateClock(session, DEFAULT_SETTINGS.clock, world.clock, wall)
    observeAsPlayer(session, 1)
    const view = playerViewOf(session, { zone: world.clock?.timeZone ?? 'UTC', wall })
    const { revision: _, ...rest } = view
    return { ...rest, api: PACK_API, suggestions: SAMPLE_SUGGESTIONS, revision: `preview-${view.revision}` }
  } finally {
    scratch.close()
  }
}
