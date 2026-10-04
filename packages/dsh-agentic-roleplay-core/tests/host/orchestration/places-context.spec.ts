import { createSessionStore, type SessionStore } from 'dsh-roleplay-state'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { CharacterRequest, PlaceView } from '../../../src/host/orchestration/boundaries.ts'
import { castSummary, describeAttitude, describeItem, describeItems, describePlace, sharedContext } from '../../../src/host/orchestration/defaults.ts'
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

describe('how a character sees those it is with', () => {
  const mine = { name: 'Bob', label: 'rival', summary: 'They fell out over the inn.', familiarity: 0.8, trust: -0.6, affinity: 0, tension: 0.7 }
  const request = (relationships?: CharacterRequest['relationships']): CharacterRequest => ({
    member: alice, cast: [arthur, alice, bob], situation: 'Arthur orders a drink.', attempt: 1, turn: 2, lookup: false, ...(relationships === undefined ? {} : { relationships }),
  })

  it('puts the label, the sentence and what the numbers come to in words, for those present', () => {
    const { prompt } = sharedContext.brief(request([mine]))
    expect(prompt).toContain('How you stand with those here (your own view of them):\n- Bob (rival): They fell out over the inn. [knows them well, distrusts them, things are strained between them]')
  })

  it('says nothing when there is no profile, and leaves out what is unremarkable', () => {
    expect(sharedContext.brief(request()).prompt).not.toContain('How you stand')
    expect(sharedContext.brief(request([{ ...mine, summary: '', familiarity: 0.4, trust: 0.1, tension: 0.1 }])).prompt).toMatch(/- Bob \(rival\)$/)
    expect(describeAttitude({ familiarity: 0.1, trust: 0.5, affinity: 0.6, tension: 0 })).toBe('barely knows them, trusts them, is fond of them')
    expect(describeAttitude({ familiarity: 0.5, trust: 0, affinity: -0.5, tension: 0.5 })).toBe('dislikes them, things are strained between them')
  })
})

describe('things in a prompt', () => {
  const lantern = { key: 'lantern', name: 'Brass lantern', quantity: 1, quality: 'dented', notable: true, hidden: false, where: 'by the till, at Counter' }
  const chest = { key: 'chest', name: 'Oak chest', quantity: 1, quality: '', notable: false, hidden: false, state: 'open', contents: ['Silver key', '3 Coin'] }

  it('says how many, in what state, where, and what is in an open container, and gives keys only when asked', () => {
    expect(describeItem(lantern, { withKeys: false })).toBe('Brass lantern (dented) [by the till, at Counter]')
    expect(describeItem({ ...chest, quantity: 3, hidden: true }, { withKeys: true })).toBe('chest: 3 Oak chest [hidden, open] holding Silver key, 3 Coin')
  })

  it('never lists more than a dozen, and says how many it left out', () => {
    const { where: _where, ...plain } = lantern
    const many = Array.from({ length: 15 }, (_, index) => ({ ...plain, key: `l${index}`, name: `Lamp ${index}`, quality: '' }))
    expect(describeItems(many, { withKeys: false })).toMatch(/Lamp 11; and 3 more$/)
  })

  it('are in the description of a place as what lies about, and a character is told what it has on it', () => {
    expect(describePlace(view({ items: [lantern, chest] }), { withKeys: false }).at(-1)).toBe('Lying about: Brass lantern (dented) [by the till, at Counter]; Oak chest [open] holding Silver key, 3 Coin')
    const request: CharacterRequest = { member: alice, cast: [arthur, alice], situation: 'Arthur orders.', attempt: 1, turn: 2, lookup: false, carrying: [{ ...lantern, where: 'carried' }, { key: 'coat', name: 'Wool coat', quantity: 1, quality: '', notable: false, hidden: false, where: 'worn on the torso' }] }
    expect(sharedContext.brief(request).prompt).toContain('What you have on you:\nBrass lantern (dented) [carried]; Wool coat [worn on the torso]')
    expect(sharedContext.brief({ ...request, carrying: [] }).prompt).not.toContain('What you have on you')
  })

  it('are told to the game master with the hidden ones too, and what each character has on them', () => {
    const story = createSessionStore(':memory:', { id: 's', name: 'S', world: { id: 'w', name: 'W' } })
    story.locations.add({ sourceId: 'the-bar', name: 'The Bar', description: 'Smoky.', features: [] })
    const text = castSummary.scene({
      cast: [placed(arthur, bar), placed(alice, bar)], turn: 2, input: 'I look around.', story: withRanking(story),
      items: { at: () => [lantern, { ...chest, hidden: true }], carried: id => (id === alice.character.id ? [{ ...lantern, key: 'coat', name: 'Wool coat', quality: '', where: 'worn on the torso' }] : []) },
    })
    expect(text).toContain('Lying about: lantern: Brass lantern (dented) [by the till, at Counter]; chest: Oak chest [hidden, open] holding Silver key, 3 Coin')
    expect(text).toContain('What characters have on them:\n- Alice (alice): coat: Wool coat [worn on the torso]')
    story.close()
  })
})
