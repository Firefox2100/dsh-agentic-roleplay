import { Context } from '@deepseek-ai/cordis'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { RoleplayState, type Session } from 'dsh-roleplay-state'
import type { CharacterDefinition } from 'dsh-roleplay-model'
import { populateCharacters, populateLocations, startingPlaceProblems } from '../../../src/host/sessions/populate.ts'
import type { LocationDefinition } from 'dsh-roleplay-model'

let dir: string
let state: RoleplayState
let session: Session

function definition(overrides: Partial<CharacterDefinition> = {}): CharacterDefinition {
  return {
    id: 'eleanor-graves',
    name: 'Eleanor Graves',
    aliases: ['the Mayor'],
    age: '42',
    pronouns: 'she/her',
    kind: 'person',
    tier: 'principal',
    role: 'npc',
    summary: 'Mayor of Blackwater Ridge.',
    personality: 'Calculating.',
    background: '',
    appearance: 'Sharp features.',
    speech: { style: 'Formal.', examples: ['Let us not make a scene.'] },
    start: {
      publicState: 'Greeting guests.',
      innerState: 'Wondering.',
      activity: 'managing appearances',
      emotion: {
        baseline: { valence: -0.1, arousal: 0.3, dominance: 0.5 },
        immediate: { valence: -0.1, arousal: 0.3, dominance: 0.5 },
      },
      intents: [{
        type: 'agenda', name: 'Contain the scandal', description: '', status: 'active', horizon: 'day',
        priority: 0.8, urgency: 0.6, plan: ['Charm the visitor'], openThreads: [], constraints: [],
      }],
    },
    ...overrides,
  }
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'populate-'))
  state = new RoleplayState(new Context(), { journalMode: 'delete' })
  session = state.createSession(join(dir, 'sessions'), { name: 'S', world: { id: 'w', name: 'W' } })
})
afterEach(async () => {
  state.deleteSession(join(dir, 'sessions'), session.metadata.get().id)
  await rm(dir, { recursive: true, force: true })
})

describe('populateCharacters', () => {
  it('stores each character with its start state and intents, linked to the world file by id', () => {
    populateCharacters(session, [definition(), definition({ id: 'clara', name: 'Clara', aliases: [], start: { publicState: '', innerState: '', activity: '', intents: [] } })], 'clara')
    const [eleanor, clara] = session.characters.list()
    expect(eleanor).toMatchObject({ sourceId: 'eleanor-graves', name: 'Eleanor Graves', aliases: ['the Mayor'], pronouns: 'she/her', role: 'npc' })
    expect(eleanor).not.toHaveProperty('start')
    expect(session.characterStates.get(eleanor?.id ?? 0)).toMatchObject({
      publicState: 'Greeting guests.', innerState: 'Wondering.', activity: 'managing appearances', version: 1,
      emotion: { baseline: { valence: -0.1, arousal: 0.3, dominance: 0.5 } },
    })
    expect(session.intents.list(eleanor?.id ?? 0).map(intent => intent.name)).toEqual(['Contain the scandal'])
    expect(clara).toMatchObject({ sourceId: 'clara', name: 'Clara' })
    expect(session.characterStates.get(clara?.id ?? 0)).not.toHaveProperty('emotion')
    expect(session.intents.list(clara?.id ?? 0)).toEqual([])
  })

  it('gives the player the chosen character and the agent everyone else', () => {
    populateCharacters(session, [
      definition({ id: 'a', name: 'A', role: 'playable' }),
      definition({ id: 'b', name: 'B', role: 'playable' }),
      definition({ id: 'c', name: 'C' }),
    ], 'b')
    expect(session.characters.list().map(character => [character.name, character.control])).toEqual([
      ['A', 'agent'], ['B', 'player'], ['C', 'agent'],
    ])
    expect(session.characters.list({ control: 'player' })).toHaveLength(1)
  })

  it('leaves everyone to the agent when the player\'s character is not in the cast', () => {
    populateCharacters(session, [definition()], 'nobody')
    expect(session.characters.list().map(character => character.control)).toEqual(['agent'])
  })

  it('does nothing for an empty cast', () => {
    populateCharacters(session, [], 'x')
    expect(session.characters.list()).toEqual([])
  })
})

const open = { oneWay: false, state: 'open' as const, note: '' }
const places: LocationDefinition[] = [
  { id: 'cellar', name: 'Cellar', description: '', parent: 'bar', features: [], exits: [{ to: 'bar', description: 'a hatch', ...open, state: 'locked', note: 'brass key', backDescription: 'a ladder' }] },
  { id: 'bar', name: 'The Bar', description: 'Smoky.', parent: 'town', features: [{ key: 'counter', name: 'Counter', description: '' }], exits: [{ to: 'street', description: 'the door', ...open, travelSeconds: 20 }] },
  { id: 'town', name: 'Town', description: '', features: [], exits: [] },
  { id: 'street', name: 'Street', description: '', parent: 'town', features: [], exits: [{ to: 'bar', description: 'the door', ...open, travelSeconds: 20 }, { to: 'roof', description: 'a ladder up', oneWay: true, state: 'open', note: '' }] },
  { id: 'roof', name: 'Roof', description: '', parent: 'street', features: [], exits: [] },
]

describe('populateLocations', () => {
  it('puts each place inside the one it belongs to, whatever the order the files came in', () => {
    populateLocations(session, places)
    const byName = Object.fromEntries(session.locations.list().map(location => [location.name, location]))
    expect(byName['Cellar']?.parentId).toBe(byName['The Bar']?.id)
    expect(byName['The Bar']?.parentId).toBe(byName['Town']?.id)
    expect(byName['Town']?.parentId).toBeUndefined()
    expect(session.locations.getBySourceId('bar')).toMatchObject({ description: 'Smoky.', features: [{ key: 'counter', name: 'Counter', description: '' }] })
  })

  it('makes each way both ways unless it is one way, without doubling a way both places wrote, and keeps state and time', () => {
    populateLocations(session, places)
    const exit = (from: string, to: string) => session.locations.getExit(session.locations.getBySourceId(from)!.id, session.locations.getBySourceId(to)!.id)
    expect(exit('bar', 'street')).toMatchObject({ description: 'the door', travelSeconds: 20, state: 'open' })
    expect(exit('street', 'bar')).toMatchObject({ description: 'the door', travelSeconds: 20 })
    expect(exit('cellar', 'bar')).toMatchObject({ description: 'a hatch', state: 'locked', note: 'brass key' })
    expect(exit('bar', 'cellar')).toMatchObject({ description: 'a ladder', state: 'locked' })
    expect(exit('street', 'roof')).toMatchObject({ description: 'a ladder up' })
    expect(exit('roof', 'street')).toBeUndefined()
    expect(session.locations.allExits()).toHaveLength(5)
  })
})

describe('where characters start', () => {
  it('puts a character in its place with the position and feature, and leaves one without a place nowhere', () => {
    populateLocations(session, places)
    const placed = definition({ id: 'arthur', name: 'Arthur', aliases: [] })
    placed.start.place = { location: 'bar', position: 'at the end', feature: 'counter' }
    populateCharacters(session, [placed, definition({ id: 'nobody-yet', name: 'Drifter', aliases: [] })], 'arthur')
    const [arthur, drifter] = session.characters.list()
    expect(session.placements.get('character', arthur!.id)).toMatchObject({ locationId: session.locations.getBySourceId('bar')!.id, position: 'at the end', featureKey: 'counter' })
    expect(session.placements.get('character', drifter!.id)).toBeUndefined()
  })

  it('reports a place that is not in the world and a feature the place does not have, before anything is made', () => {
    const lost = definition({ id: 'lost', name: 'Lost', aliases: [] })
    lost.start.place = { location: 'moon' }
    const wrong = definition({ id: 'wrong', name: 'Wrong', aliases: [] })
    wrong.start.place = { location: 'bar', feature: 'piano' }
    const fine = definition({ id: 'fine', name: 'Fine', aliases: [] })
    fine.start.place = { location: 'bar', feature: 'counter' }
    expect(startingPlaceProblems([lost, wrong, fine], places)).toEqual([
      'lost: start.location "moon" is not a place of this world',
      'wrong: start.feature "piano" is not a feature of The Bar (it has: counter)',
    ])
  })
})
