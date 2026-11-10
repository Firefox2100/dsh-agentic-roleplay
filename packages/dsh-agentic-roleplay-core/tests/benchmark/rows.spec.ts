import { Context } from '@deepseek-ai/cordis'
import { existsSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { RoleplayState, type Session } from '@dsh-agentic-roleplay/state'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { startSession, type StartSessionDeps } from '../../src/host/sessions/start-session.ts'
import type { RoleplayRoot } from '../../src/host/storage/roleplay-root.ts'
import { WorldCatalog } from '../../src/host/worlds/catalog.ts'
import { FEATURES, loadData, tierOf, worldOfRow, type Feature, type Row } from './framework/index.ts'
import { writeFiles } from './write.ts'

/**
 * The offline runner: every row of the data is composed into a world, started as a real story, and held to what the row says: who plays and how many others the story can ask, and
 * each feature the row claims reaches the story while each it does not claim is absent from it. Nothing here calls a model. Adding a row adds a case.
 */
const data = loadData()

let root: string
let state: RoleplayState
let deps: StartSessionDeps
let opening: readonly { type: string; text: string }[] | undefined

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'benchmark-row-'))
  opening = undefined
  state = new RoleplayState(new Context(), { journalMode: 'delete' })
  deps = {
    worlds: new WorldCatalog(new Context(), { path: root } as RoleplayRoot),
    state,
    agent: { ensure: (id, _title, parts) => { opening = parts; return Promise.resolve(`session-${id}`) }, retire: () => Promise.resolve() },
    sessionsDir: () => join(root, 'sessions'),
    root: () => root,
  }
})
afterEach(async () => { await rm(root, { recursive: true, force: true }) })

/** Whether a feature is in a started story. A feature the session cannot show by itself (tools, start questions, packs) is not judged here. */
const REACHES: Partial<Record<Feature, (session: Session, folder: string) => boolean>> = {
  places: session => session.locations.list().length > 0,
  items: session => session.items.list().length > 0,
  factions: session => session.factions.list().length > 0,
  lore: session => session.lore.list().length > 0,
  variables: session => session.variables.defs().some(def => !def.builtin && !def.key.startsWith('command_')),
  triggers: session => session.triggers.list().length > 0,
  dice: session => session.dice.checks().length > 0,
  routines: session => session.characters.list().some(character => session.routines.list(character.id).length > 0),
  calendar: session => session.metadata.getValue('calendar') !== undefined,
  plots: session => ((session.metadata.getValue('roleplay.pacing.plots') as unknown[] | undefined) ?? []).length > 0,
  rules: session => ((session.metadata.getValue('rules') as unknown[] | undefined) ?? []).length > 0,
  prompts: (_session, folder) => existsSync(join(folder, 'prompts')),
}

async function start(row: Row): Promise<{ session: Session; folder: string }> {
  const composed = worldOfRow(data, row)
  expect(composed.problems).toEqual([])
  await writeFiles(join(root, 'worlds', row.id), composed.files)
  const id = (composed.files.get('world.json') as { id: string }).id
  const started = await startSession(deps, { worldId: id, playerCharacterId: row.cast.player })
  return { session: state.openSession(join(root, 'sessions'), started.id) as unknown as Session, folder: join(root, 'sessions', started.id) }
}

describe.each(data.rows.map(row => [row.id, row] as const))('the row %s, started as a story', (_id, row) => {
  it('has the player, and exactly the other characters the row says the story can ask', async () => {
    const { session } = await start(row)
    const cast = session.characters.list()
    expect(cast.filter(character => character.control === 'player').map(character => character.sourceId)).toEqual([row.cast.player])
    expect(cast.filter(character => character.control === 'agent')).toHaveLength(row.cast.npcs)
    expect(tierOf(row.cast.npcs)).toBeDefined()
  })

  it('opens the chat, and puts everybody somewhere when the world has places', async () => {
    const { session } = await start(row)
    expect(opening === undefined || opening.length > 0).toBe(true)
    if (row.features.includes('places')) for (const character of session.characters.list()) expect(session.placements.get('character', character.id), character.sourceId).toBeDefined()
  })

  it('carries each feature the row claims into the story, and none it does not', async () => {
    const { session, folder } = await start(row)
    const wrong = FEATURES.flatMap((feature) => {
      const reaches = REACHES[feature]
      if (reaches === undefined) return []
      return reaches(session, folder) === row.features.includes(feature) ? [] : [`${feature}: ${row.features.includes(feature) ? 'claimed but not in the story' : 'in the story but not claimed'}`]
    })
    expect(wrong).toEqual([])
  })
})
