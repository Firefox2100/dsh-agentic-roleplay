import { createSessionStore, type SessionStore } from 'dsh-roleplay-state'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { CharacterRequest, PlaceView } from '../../../src/host/orchestration/boundaries.ts'
import { castSummary, describeAgenda, describeAttitude, describeItem, describeItems, describePlace, describeSceneAgenda, sharedContext } from '../../../src/host/orchestration/defaults.ts'
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

  it('dates memories by elapsed story time', () => {
    const now = Date.UTC(1912, 9, 7, 12)
    const prompt = sharedContext.brief(request({
      time: { mode: 'simulated', now, zone: 'UTC' },
      memories: [{ clarity: 'clear', text: 'The key was hidden.', turn: 1, at: now - 3 * 86_400_000, source: { kind: 'perception', id: 1 } }],
    })).prompt
    expect(prompt).toContain('- (3 days ago) The key was hidden.')
  })

  it('gives a character its known entity graph without implying current state', () => {
    const prompt = sharedContext.brief(request({ knowledge: { characters: ['Bob (bob)'], factions: ['Harbour Watch (watch)'], locations: ['Station (station)'], items: ['Brass key (key)'], routes: ['The Bar -> Station'] } })).prompt
    expect(prompt).toContain('What you know exists (this does not tell you where it is now or what state it is in):')
    expect(prompt).toContain('People: Bob (bob)')
    expect(prompt).toContain('Factions: Harbour Watch (watch)')
    expect(prompt).toContain('Places: Station (station)')
    expect(prompt).toContain('Routes: The Bar -> Station')
    expect(prompt).toContain('Things: Brass key (key)')
  })

  it('presents faction goals as pressures rather than commands', () => {
    const prompt = sharedContext.brief(request({ affiliations: [{ name: 'Harbour Watch', role: 'officer', rank: 'constable', status: 'active', commitment: 0.8, publicState: 'The Watch is on alert.', goals: ['Secure the harbour'] }] })).prompt
    expect(prompt).toContain('Your affiliations (their goals are pressures and commitments, not commands):')
    expect(prompt).toContain('Harbour Watch: officer, constable; active; commitment 0.80')
    expect(prompt).toContain('Goals: Secure the harbour')
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
    expect(text).toContain('Characters here:\n- Arthur (the player\'s character, "arthur") [at the bar]')
    expect(text).toContain('- Alice (acts through "alice")')
    expect(text).toContain('Characters elsewhere (they perceive nothing here unless the moment reaches them):\n- Bob (acts through "bob")')
    expect(text).toContain('in Cellar (cellar)')
  })

  it('lists a character with no place on its own', () => {
    expect(scene([placed(arthur, bar), alice])).toContain('Characters with no place yet:\n- Alice')
  })

  it('is the plain list of characters when nobody has a place', () => {
    const text = scene([arthur, alice])
    expect(text).toContain('Scene before turn 2:\n- Arthur (the player\'s character, "arthur"): Arthur summary\n- Alice (acts through "alice"): Alice summary')
    expect(text).toContain('Likely characters to activate, in priority order')
  })
})

describe('how a character sees those it is with', () => {
  const mine = { name: 'Bob', label: 'rival', summary: 'They fell out over the inn.', present: true, familiarity: 0.8, trust: -0.6, affinity: 0, tension: 0.7 }
  const request = (relationships?: CharacterRequest['relationships']): CharacterRequest => ({
    member: alice, cast: [arthur, alice, bob], situation: 'Arthur orders a drink.', attempt: 1, turn: 2, lookup: false, ...(relationships === undefined ? {} : { relationships }),
  })

  it('puts the label, the sentence and what the numbers come to in words, for those present', () => {
    const { prompt } = sharedContext.brief(request([mine]))
    expect(prompt).toContain('How you stand with people who bear on this moment (your own view, not objective fact):\n- Bob (here) — rival: They fell out over the inn. [knows them well, distrusts them, things are strained between them]')
  })

  it('says nothing when there is no profile, and leaves out what is unremarkable', () => {
    expect(sharedContext.brief(request()).prompt).not.toContain('How you stand')
    expect(sharedContext.brief(request([{ ...mine, summary: '', familiarity: 0.4, trust: 0.1, tension: 0.1 }])).prompt).toMatch(/- Bob \(here\) — rival$/)
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

describe('time in a prompt', () => {
  const evening = Date.UTC(1912, 9, 4, 21, 40)
  const story = () => withRanking(createSessionStore(':memory:', { id: 's', name: 'S', world: { id: 'w', name: 'W' } }))

  it('tells the game master the time and, in simulated time, that it moves only as the game master says', () => {
    const text = castSummary.scene({ time: { now: { mode: 'simulated', now: evening, zone: 'UTC' } }, cast: [arthur, alice], turn: 2, input: 'I look around.', story: story() })
    expect(text.split('\n\n')[0]).toBe('Time: Friday 4 October 1912, 21:40 (evening). The story\'s time moves only as you say: each round takes what you give it (elapsed_seconds in resolve_round, or the default), and advance_time skips ahead.')
  })

  it('tells it that the real clock cannot be skipped, and how long the player was away when that is long enough to matter', () => {
    const real = { mode: 'real' as const, now: evening, zone: 'Asia/Shanghai' }
    const away = castSummary.scene({ time: { now: real, away: 3 * 3_600_000 + 12 * 60_000 }, cast: [arthur], turn: 2, input: 'Hi.', story: story() })
    expect(away).toContain('Time: Saturday 5 October 1912, 05:40 (morning). The story\'s time follows the real clock: it cannot be skipped')
    expect(away).toContain('The player was away for 3 hours 12 minutes of real time and the story went on meanwhile')
    const brief = castSummary.scene({ time: { now: real, away: 4 * 60_000 }, cast: [arthur], turn: 2, input: 'Hi.', story: story() })
    expect(brief).not.toContain('away')
  })

  it('says nothing about time when there is no clock', () => {
    expect(castSummary.scene({ cast: [arthur], turn: 1, input: 'Hi.', story: story() })).not.toContain('Time:')
  })

  it('tells a character what time it is, after the situation', () => {
    const request: CharacterRequest = { member: alice, cast: [arthur, alice], situation: 'Arthur orders.', attempt: 1, turn: 2, lookup: false, time: { mode: 'simulated', now: Date.UTC(1912, 9, 4, 3, 5), zone: 'UTC' } }
    expect(sharedContext.brief(request).prompt.split('\n\n').slice(0, 2)).toEqual(['Situation:\nArthur orders.', 'Now: Friday 4 October 1912, 03:05 (night).'])
    const { time: _time, ...without } = request
    expect(sharedContext.brief(without).prompt).not.toContain('Now:')
  })
})

describe('days in a prompt', () => {
  const evening = Date.UTC(1912, 9, 4, 21, 40)
  const agenda = {
    zone: 'UTC',
    now: { activity: 'drinks at the bar', place: 'The Bar', until: Date.UTC(1912, 9, 4, 22), interruptible: true },
    next: { activity: 'sleeps', place: 'Home', at: Date.UTC(1912, 9, 4, 22) },
    engagements: [{ title: 'Return the key', at: Date.UTC(1912, 9, 4, 20), with: [], overdue: true }, { title: 'Meet Marcus', at: Date.UTC(1912, 9, 5, 8), place: 'The Shop', with: ['Marcus'], overdue: false }],
    goals: [{ name: 'Find the ledger', type: 'obligation', description: 'Promised Bob. Urgent.', plan: ['Search the shop', 'Ask Marcus'], deadline: Date.UTC(1912, 9, 5, 9), overdue: false }],
  }

  it('is told to a character as its own day: what it is doing and next, what it is due to do, and what it is after, as plans', () => {
    const request: CharacterRequest = { member: alice, cast: [arthur, alice], situation: 'Arthur orders.', attempt: 1, turn: 2, lookup: false, time: { mode: 'simulated', now: evening, zone: 'UTC' }, agenda }
    const prompt = sharedContext.brief(request).prompt
    expect(prompt).toContain('Your day and what you are after (plans, not orders: keep them, put them off or drop them as the moment and your character suggest):')
    expect(prompt).toContain('Your day, now: drinks at the bar at The Bar, until 22:00.\nYour day, next: sleeps at Home, from 22:00.')
    expect(prompt).toContain('You were to: Return the key, at 20:00, which has passed and is still open.')
    expect(prompt).toContain('You are due to: Meet Marcus at The Shop, with Marcus, at Saturday 5 October 1912, 08:00.')
    expect(prompt).toContain('What you are after:\n- Find the ledger (obligation), by Saturday 5 October 1912, 09:00: Promised Bob. Next: Search the shop; Ask Marcus.')
    const { agenda: _agenda, ...without } = request
    expect(sharedContext.brief(without).prompt).not.toContain('Your day')
    expect(sharedContext.brief({ ...request, agenda: { zone: 'UTC', engagements: [], goals: [] } }).prompt).not.toContain('Your day')
  })

  it('says a window that is not to be dropped lightly', () => {
    expect(describeAgenda({ ...agenda, now: { ...agenda.now, interruptible: false } }, evening)[0]).toBe('Your day, now: drinks at the bar at The Bar, until 22:00 (not something you would drop lightly).')
  })

  it('is told to the game master as who moved, whose day expects them elsewhere, and what is due', () => {
    const text = describeSceneAgenda({
      zone: 'UTC',
      moved: [{ character: 'marcus', name: 'Marcus', to: 'Home', activity: 'rests' }],
      here: [{ name: 'Clara', note: 'its day says "sleeps" at Home now, yet it is here' }],
      engagements: [{ title: 'Meet Marcus', at: Date.UTC(1912, 9, 4, 21), place: 'The Shop', with: ['Clara', 'Marcus'], overdue: true }, { title: 'Soon', at: Date.UTC(1912, 9, 4, 22), with: ['Marcus'], overdue: false }],
    }, evening)
    expect(text).toBe([
      'By their routines since you last looked: Marcus went to Home (rests).',
      'With the player\'s character, and their days: Clara: its day says "sleeps" at Home now, yet it is here. The characters decide for themselves whether to keep to their day; the moment may keep them.',
      'Commitments due soon or overdue: "Meet Marcus" (Clara, Marcus, at The Shop) was due 21:00 and is still open; "Soon" (Marcus) is due 22:00.',
    ].join('\n'))
    expect(describeSceneAgenda({ zone: 'UTC', moved: [], here: [], engagements: [] }, evening)).toBe('')
  })

  it('goes after the time in the scene, and is absent when there is nothing to tell', () => {
    const scene = castSummary.scene({ time: { now: { mode: 'simulated', now: evening, zone: 'UTC' }, agenda: { zone: 'UTC', moved: [{ character: 'marcus', name: 'Marcus', to: 'Home', activity: 'rests' }], here: [], engagements: [] } }, cast: [arthur], turn: 2, input: 'Hi.', story: withRanking(createSessionStore(':memory:', { id: 's', name: 'S', world: { id: 'w', name: 'W' } })) })
    expect(scene.split('\n\n').slice(0, 2).map(part => part.slice(0, 22))).toEqual(['Time: Friday 4 October', 'By their routines sinc'])
    const quiet = castSummary.scene({ time: { now: { mode: 'simulated', now: evening, zone: 'UTC' }, agenda: { zone: 'UTC', moved: [], here: [], engagements: [] } }, cast: [arthur], turn: 2, input: 'Hi.', story: withRanking(createSessionStore(':memory:', { id: 's', name: 'S', world: { id: 'w', name: 'W' } })) })
    expect(quiet).not.toContain('routines')
  })
})

describe('what the story keeps track of, in a prompt', () => {
  it('is told to a character as how it is and what it can tell of those with it', () => {
    const request: CharacterRequest = { member: alice, cast: [arthur, alice], situation: 'Arthur orders.', attempt: 1, turn: 2, lookup: false, tracked: { self: 'Health: hurt (2); Valence: unhappy (-0.5), usually even (0)', others: [{ name: 'Arthur', text: 'Health: well (10)' }] } }
    const prompt = sharedContext.brief(request).prompt
    expect(prompt).toContain('How you are (what you can tell of yourself):\nHealth: hurt (2); Valence: unhappy (-0.5), usually even (0)')
    expect(prompt).toContain('What you can tell of the others here:\n- Arthur: Health: well (10)')
    const quiet = sharedContext.brief({ ...request, tracked: { self: '', others: [] } }).prompt
    expect(quiet).not.toContain('How you are')
    expect(quiet).not.toContain('What you can tell of the others')
  })

  it('is told to the game master as lines, with how to change it', () => {
    const story = withRanking(createSessionStore(':memory:', { id: 's', name: 'S', world: { id: 'w', name: 'W' } }))
    const text = castSummary.scene({ tracked: ['the world: Alarm: yes', 'Alice (alice): Health: hurt (2)'], cast: [arthur], turn: 2, input: 'Hi.', story })
    expect(text).toContain('What the story keeps track of (change it with variable_changes in an outcome when what happened calls for it):\n- the world: Alarm: yes\n- Alice (alice): Health: hurt (2)')
    expect(castSummary.scene({ tracked: [], cast: [arthur], turn: 2, input: 'Hi.', story })).not.toContain('keeps track')
  })
})
