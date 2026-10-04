import { createSessionStore, type SessionStore } from 'dsh-roleplay-state'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { CharacterRequest, PlaceView } from '../../../src/host/orchestration/boundaries.ts'
import { castSummary, describePlace, sharedContext } from '../../../src/host/orchestration/defaults.ts'
import { alice, arthur, bob, location, placed, withRanking } from './fixtures.ts'

const bar = location(1, 'The Bar', { description: 'Smoky. Loud at night.', features: [{ key: 'counter', name: 'Counter', description: 'Long and sticky. Stained.' }, { key: 'piano', name: 'Piano', description: '' }] })
const cellar = location(2, 'Cellar')

const view = (extra: Partial<PlaceView> = {}): PlaceView => ({
  key: 'the-bar', location: bar, here: [placed(arthur, bar, 'at the bar'), placed(alice, bar)],
  exits: [
    { key: 'street', name: 'Main Street', exit: { id: 1, fromId: 1, toId: 3, description: 'the front door. Heavy.', state: 'open', note: '' } },
    { key: 'cellar', name: 'Cellar', exit: { id: 2, fromId: 1, toId: 2, description: 'a hatch', state: 'locked', note: 'needs the brass key' } },
  ],
  ...extra,
})

describe('describing a place', () => {
  it('says what it is like, what can be pointed at and the ways out with their state, and gives keys only when asked', () => {
    expect(describePlace(view(), { withKeys: false })).toEqual([
      'The Bar: Smoky. Loud at night.',
      'Things here: Counter - Long and sticky.; Piano',
      'Ways out: Main Street (the front door.); Cellar (a hatch) [locked: needs the brass key]',
    ])
    expect(describePlace(view(), { withKeys: true })).toEqual([
      'The Bar (the-bar): Smoky. Loud at night.',
      'Things here: counter: Counter - Long and sticky.; piano: Piano',
      'Ways out: street: Main Street (the front door.); cellar: Cellar (a hatch) [locked: needs the brass key]',
    ])
  })

  it('never lists more than a dozen features or ways out, and says how many it left out', () => {
    const many = location(9, 'Warehouse', { features: Array.from({ length: 20 }, (_, index) => ({ key: `f${index}`, name: `Thing ${index}`, description: '' })) })
    const exits = Array.from({ length: 15 }, (_, index) => ({ key: `p${index}`, name: `Place ${index}`, exit: { id: index, fromId: 9, toId: index, description: '', state: 'open' as const, note: '' } }))
    const lines = describePlace({ key: 'warehouse', location: many, exits, here: [] }, { withKeys: false })
    expect(lines[1]).toMatch(/Thing 11; and 8 more$/)
    expect(lines[2]).toMatch(/Place 11; and 3 more$/)
  })
})

describe('what a character is told', () => {
  const request = (extra: Partial<CharacterRequest> = {}): CharacterRequest => ({
    member: placed(alice, bar), cast: [placed(arthur, bar, 'at the bar'), placed(alice, bar), placed(bob, cellar)], situation: 'Arthur orders a drink.', attempt: 1, turn: 2, lookup: false, place: view(), ...extra,
  })

  it('is the place it is in and only those who are there, with where each stands', () => {
    const { prompt } = sharedContext.brief(request())
    expect(prompt).toContain('Where you are:\nThe Bar: Smoky.')
    expect(prompt).toContain('Present:\n- Arthur (at the bar)')
    expect(prompt).toContain('- Alice (you)')
    expect(prompt).not.toContain('Bob')
  })

  it('is everyone, as before, when the story has no places', () => {
    const { place: _place, ...plain } = request({ member: alice, cast: [arthur, alice, bob] })
    const { prompt } = sharedContext.brief(plain)
    expect(prompt).not.toContain('Where you are')
    expect(prompt).toContain('- Bob')
  })
})

describe('the scene the game master is told, with places', () => {
  let story: SessionStore
  beforeEach(() => { story = createSessionStore(':memory:', { id: 's', name: 'S', world: { id: 'w', name: 'W' } }) })
  afterEach(() => { story.close() })

  const scene = (cast = [placed(arthur, bar, 'at the bar'), placed(alice, bar), placed(bob, cellar)]) => {
    story.locations.add({ sourceId: 'the-bar', name: 'The Bar', description: 'Smoky.', features: [] })
    return castSummary.scene({ cast, turn: 2, input: 'I order.', story: withRanking(story) })
  }

  it('is where the player is with what is there, who is with them, and who is elsewhere and where', () => {
    const text = scene()
    expect(text).toContain("The player's character is in The Bar (the-bar): Smoky.")
    expect(text).toContain('Characters here:\n- Arthur (the player\'s character) [at the bar]')
    expect(text).toContain('- Alice (acts through "alice")')
    expect(text).toContain('Characters elsewhere (they perceive nothing here unless the moment reaches them):\n- Bob (acts through "bob")')
    expect(text).toContain('in Cellar (cellar)')
  })

  it('lists a character with no place on its own', () => {
    expect(scene([placed(arthur, bar), alice])).toContain('Characters with no place yet:\n- Alice')
  })

  it('is the plain list of characters when nobody has a place', () => {
    const text = scene([arthur, alice])
    expect(text).toBe('Scene before turn 2:\n- Arthur (the player\'s character): Arthur summary\n- Alice (acts through "alice"): Alice summary')
  })
})
