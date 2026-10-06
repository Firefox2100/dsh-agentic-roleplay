import { Context } from '@deepseek-ai/cordis'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { RoleplayState, type Session } from 'dsh-roleplay-state'
import type { CharacterDefinition } from 'dsh-roleplay-model'
import { populateCharacters, populateItems, populateLocations, populateRoutines, relationshipProblems, routineProblems, startingPlaceProblems } from '../../../src/host/sessions/populate.ts'
import type { ItemDefinition, LocationDefinition } from 'dsh-roleplay-model'

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
    })
    expect(['valence', 'arousal', 'dominance'].map(axis => session.variables.get(axis, 'character', eleanor!.id))).toMatchObject([{ value: -0.1, baseline: -0.1 }, { value: 0.3, baseline: 0.3 }, { value: 0.5, baseline: 0.5 }])
    expect(session.intents.list(eleanor?.id ?? 0).map(intent => intent.name)).toEqual(['Contain the scandal'])
    expect(clara).toMatchObject({ sourceId: 'clara', name: 'Clara' })
    expect(session.variables.list('character', clara!.id)).toEqual([])
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

  it('copies authored visual identities into their own session table', () => {
    const visualIdentity = { globalId: 'person-eleanor', description: 'Sharp features.', tags: ['grey eyes'], negativeTags: [] }
    populateCharacters(session, [definition({ visualIdentity })], 'nobody')
    const character = session.characters.getBySourceId('eleanor-graves')!
    expect(session.visualIdentities.get('character', character.id)).toMatchObject({ ...visualIdentity, version: 1 })
    expect(character).not.toHaveProperty('visualIdentity')
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

describe('relationships between the characters of a world', () => {
  it('are stored as one profile per direction, from the file of the character whose view it is', () => {
    const arthur = definition({ id: 'arthur', name: 'Arthur', aliases: [], relationships: [{ to: 'eleanor-graves', label: 'suspect', summary: 'She hides something.', familiarity: 0.3, trust: -0.2, affinity: 0, tension: 0.4 }] })
    populateCharacters(session, [arthur, definition({ relationships: [{ to: 'arthur', label: 'nuisance', summary: '', familiarity: 0, trust: 0, affinity: -0.3, tension: 0.2 }] })], 'arthur')
    const [a, e] = [session.characters.getBySourceId('arthur')!, session.characters.getBySourceId('eleanor-graves')!]
    expect(session.relationships.get(a.id, e.id)).toMatchObject({ label: 'suspect', summary: 'She hides something.', trust: -0.2, tension: 0.4, updatedTurn: 0 })
    expect(session.relationships.get(e.id, a.id)).toMatchObject({ label: 'nuisance', affinity: -0.3 })
    expect(session.characters.list().map(character => 'relationships' in character)).toEqual([false, false])
  })

  it('are reported before anything is made when they name someone the world does not have, or the character itself', () => {
    const lost = definition({ id: 'lost', name: 'Lost', aliases: [], relationships: [{ to: 'ghost', label: 'x', summary: '', familiarity: 0, trust: 0, affinity: 0, tension: 0 }, { to: 'lost', label: 'x', summary: '', familiarity: 0, trust: 0, affinity: 0, tension: 0 }] })
    expect(relationshipProblems([lost, definition()])).toEqual([
      'lost: relationships: "ghost" is not a character of this world',
      'lost: relationships: a character has no relationship with itself',
    ])
    expect(relationshipProblems([definition()])).toEqual([])
  })
})

describe('the things of a world', () => {
  const thing = (id: string, start: ItemDefinition['start'], extra: Partial<ItemDefinition> = {}): ItemDefinition => ({ id, name: id.toUpperCase(), description: '', quantity: 1, unique: false, quality: '', notable: false, hidden: false, start, ...extra })

  it('puts each thing where it starts, containers before what is in them, with what opens each lock, on items and on ways', () => {
    populateLocations(session, places)
    populateCharacters(session, [definition({ id: 'arthur', name: 'Arthur', aliases: [] }), definition()], 'arthur')
    populateItems(session, [
      thing('coins', { kind: 'inside', item: 'purse' }, { quantity: 40 }),
      thing('purse', { kind: 'held', character: 'arthur' }, { container: { state: 'closed', openedBy: [] } }),
      thing('chest', { kind: 'location', location: 'bar', feature: 'counter', position: 'by the till' }, { container: { state: 'locked', openedBy: ['key'] }, owner: 'eleanor-graves', hidden: true }),
      thing('key', { kind: 'worn', character: 'eleanor-graves', position: 'on a chain' }, { wearable: 'neck', unique: true, notable: true }),
    ], [{ id: 'neck', name: 'neck', capacity: 1 }, { id: 'quiver', name: 'quiver', capacity: 1 }], [{ ...places[1]!, exits: [{ to: 'street', description: 'the door', oneWay: false, state: 'locked', note: '', openedBy: ['key'] }] }, places[3]!])
    const [coins, purse, chest, key] = ['coins', 'purse', 'chest', 'key'].map(id => session.items.getBySourceId(id)!)
    expect(session.items.holding(coins!.id)?.holder).toEqual({ kind: 'item', itemId: purse!.id })
    expect(coins).toMatchObject({ quantity: 40 })
    expect(session.items.holding(chest!.id)?.holder).toMatchObject({ kind: 'location', featureKey: 'counter', position: 'by the till' })
    expect(chest).toMatchObject({ hidden: true, container: { state: 'locked' }, ownerId: session.characters.getBySourceId('eleanor-graves')!.id })
    expect(session.items.holding(key!.id)?.holder).toMatchObject({ kind: 'character', mode: 'worn', slot: 'neck', position: 'on a chain' })
    expect(session.items.openers({ kind: 'item', id: chest!.id })).toEqual([key!.id])
    const bar = session.locations.getBySourceId('bar')!
    const street = session.locations.getBySourceId('street')!
    expect(session.items.openers({ kind: 'exit', id: session.locations.getExit(bar.id, street.id)!.id })).toEqual([key!.id])
    expect(session.items.openers({ kind: 'exit', id: session.locations.getExit(street.id, bar.id)!.id })).toEqual([key!.id])
    expect(session.slots.get('quiver')).toBeDefined()
    expect(session.consolidation.pending()).toEqual([])
  })
})

describe('the days of the characters of a world', () => {
  const place = (id: string, features: string[] = []): LocationDefinition => ({ id, name: id, description: '', features: features.map(key => ({ key, name: key, description: '' })), exits: [] })
  const window = { days: ['mon', 'fri'], from: '09:00', to: '17:00', activity: 'minds the shop', interruptible: false } as const

  it('are refused when they name a place or a feature the world does not have, before anything is created', () => {
    const shop = place('shop', ['counter'])
    const days = (routine: NonNullable<CharacterDefinition['routine']>) => routineProblems([definition({ routine })], [shop])
    expect(days([{ ...window, days: [...window.days], location: 'shop', feature: 'counter' }, { ...window, days: [] }])).toEqual([])
    expect(days([{ ...window, days: [], location: 'moon' }])).toEqual(['eleanor-graves: routine[0].location "moon" is not a place of this world'])
    expect(days([{ ...window, days: [], location: 'shop', feature: 'piano' }])).toEqual(['eleanor-graves: routine[0].feature "piano" is not a feature of shop'])
    expect(routineProblems([definition()], [shop])).toEqual([])
  })

  it('are given to each character, with days as numbers, minutes of the day and the place in the session', () => {
    populateLocations(session, [place('shop', ['counter'])])
    populateCharacters(session, [definition({ routine: [{ ...window, days: [...window.days], location: 'shop', feature: 'counter', position: 'behind it' }, { days: [], from: '22:00', to: '06:30', activity: 'sleeps', interruptible: true }] }), definition({ id: 'clara', name: 'Clara', aliases: [] })], 'clara')
    populateRoutines(session, [definition({ routine: [{ ...window, days: [...window.days], location: 'shop', feature: 'counter', position: 'behind it' }, { days: [], from: '22:00', to: '06:30', activity: 'sleeps', interruptible: true }] })])
    const windows = session.routines.list(session.characters.getBySourceId('eleanor-graves')!.id)
    expect(windows.map(entry => [entry.days, entry.start, entry.end, entry.activity, entry.interruptible, entry.featureKey, entry.position])).toEqual([
      [[1, 5], 540, 1020, 'minds the shop', false, 'counter', 'behind it'], [[], 1320, 390, 'sleeps', true, undefined, undefined],
    ])
    expect(windows[0]?.locationId).toBe(session.locations.getBySourceId('shop')!.id)
    expect(session.routines.list(session.characters.getBySourceId('clara')!.id)).toEqual([])
  })
})
