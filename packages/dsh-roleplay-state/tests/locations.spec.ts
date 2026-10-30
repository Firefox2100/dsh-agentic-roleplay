import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ConflictError, DEFAULT_MEMORY_POLICY, InvalidEditError, InvalidMoveError, InvalidValueError, NotFoundError, locationKey, parseRecordsEdit, recordsEditSchema, type RecordsEdit, type SessionStore } from '../src/index.ts'
import { memoryStore, newCharacter } from './helpers.ts'

let store: SessionStore
const idOf = (key: string) => store.characters.getBySourceId(key)!.id
const place = (key: string) => store.locations.getBySourceId(key)!
const problemsOf = (change: RecordsEdit): string[] => {
  try { store.edit(change) } catch (error) { if (error instanceof InvalidEditError) return [...error.problems]; throw error }
  return []
}

/** A bar with a back room and a cellar behind a locked door, a street outside, and a quarry far away with no road. */
beforeEach(() => {
  store = memoryStore()
  for (const [sourceId, name] of [['alice', 'Alice'], ['bob', 'Bob']] as const) store.characters.add(newCharacter({ sourceId, name, aliases: [] }))
  store.edit({
    turn: 1,
    places: [
      { key: 'town', name: 'Town' },
      { key: 'bar', name: 'The Bar', parent: 'town', description: 'Smoky.', features: [{ key: 'counter', name: 'The counter', description: 'Long and sticky.' }] },
      { key: 'street', name: 'Main Street', parent: 'town', exits: [{ to: 'bar', description: 'the bar door', travelSeconds: 20 }] },
      { key: 'cellar', name: 'Cellar', parent: 'bar', exits: [{ to: 'bar', description: 'a hatch', state: 'locked', note: 'needs the brass key' }] },
      { key: 'quarry', name: 'Quarry', parent: 'town' },
    ],
  })
})
afterEach(() => { store.close() })

describe('places', () => {
  it('are made with a parent and features, and found by key', () => {
    const bar = place('bar')
    expect(bar).toMatchObject({ name: 'The Bar', description: 'Smoky.', parentId: place('town').id, features: [{ key: 'counter', name: 'The counter', description: 'Long and sticky.' }] })
    expect(locationKey(bar)).toBe('bar')
    expect(store.locations.childrenOf(place('town').id).map(child => child.name)).toEqual(['The Bar', 'Main Street', 'Quarry'])
    expect(locationKey({ id: 7 })).toBe('7')
  })

  it('refuse a missing parent, a repeated key, a name-less place and bad or too many features', () => {
    expect(() => store.locations.add({ name: 'X', description: '', parentId: 999, features: [] })).toThrow(NotFoundError)
    expect(() => store.locations.add({ sourceId: 'bar', name: 'Another', description: '', features: [] })).toThrow(ConflictError)
    expect(() => store.locations.add({ name: ' ', description: '', features: [] })).toThrow(InvalidValueError)
    expect(() => store.locations.add({ name: 'X', description: '', features: [{ key: 'a b', name: 'A', description: '' }] })).toThrow(InvalidValueError)
    expect(() => store.locations.add({ name: 'X', description: '', features: [{ key: 'a', name: 'A', description: '' }, { key: 'a', name: 'B', description: '' }] })).toThrow(ConflictError)
    expect(() => store.locations.add({ name: 'X', description: '', features: Array.from({ length: 31 }, (_, index) => ({ key: `f${index}`, name: 'F', description: '' })) })).toThrow(/at most 30/)
  })

  it('can be renamed and described again, but a feature somebody is at cannot be removed', () => {
    store.edit({ turn: 1, moves: [{ character: 'alice', to: 'bar', feature: 'counter' }] })
    expect(() => store.locations.update(place('bar').id, { features: [] })).toThrow(/someone is at it/)
    expect(store.locations.update(place('bar').id, { description: 'Quiet now.', features: [{ key: 'counter', name: 'Counter', description: '' }, { key: 'door', name: 'Door', description: '' }] }).features).toHaveLength(2)
  })
})

describe('exits', () => {
  it('can be moved into another place or taken out of the one they are in, but never into themselves or what they hold', () => {
    store.locations.update(place('quarry').id, { parentId: place('bar').id })
    expect(place('quarry').parentId).toBe(place('bar').id)
    store.locations.update(place('quarry').id, { parentId: null })
    expect(place('quarry').parentId).toBeUndefined()
    expect(() => store.locations.update(place('bar').id, { parentId: place('cellar').id })).toThrow(InvalidValueError)
    expect(() => store.locations.update(place('bar').id, { parentId: place('bar').id })).toThrow(InvalidValueError)
    expect(() => store.locations.update(place('bar').id, { parentId: 9999 })).toThrow(NotFoundError)
    expect(place('bar').parentId).toBe(place('town').id)
  })

  it('lead one way at a time, made both ways unless told otherwise', () => {
    expect(store.locations.exitsFrom(place('street').id).map(exit => [exit.toId, exit.state, exit.travelSeconds])).toEqual([[place('bar').id, 'open', 20]])
    expect(store.locations.getExit(place('bar').id, place('street').id)).toMatchObject({ description: 'the bar door', travelSeconds: 20 })
    expect(store.locations.getExit(place('cellar').id, place('bar').id)).toMatchObject({ state: 'locked', note: 'needs the brass key' })
    expect(store.locations.getExit(place('bar').id, place('cellar').id)).toMatchObject({ state: 'locked' })
    store.edit({ turn: 1, places: [{ key: 'roof', name: 'Roof', parent: 'bar', exits: [{ to: 'bar', oneWay: true }] }] })
    expect(store.locations.getExit(place('bar').id, place('roof').id)).toBeUndefined()
  })

  it('refuse a second exit in the same direction, to itself, to nowhere, or with a bad state or time', () => {
    const [bar, street] = [place('bar').id, place('street').id]
    expect(() => store.locations.addExit({ fromId: street, toId: bar, description: '' })).toThrow(ConflictError)
    expect(() => store.locations.addExit({ fromId: bar, toId: bar, description: '' })).toThrow(InvalidValueError)
    expect(() => store.locations.addExit({ fromId: bar, toId: 999, description: '' })).toThrow(NotFoundError)
    expect(() => store.locations.addExit({ fromId: bar, toId: place('quarry').id, description: '', state: 'ajar' as never })).toThrow(InvalidValueError)
    expect(() => store.locations.addExit({ fromId: bar, toId: place('quarry').id, description: '', travelSeconds: -1 })).toThrow(InvalidValueError)
  })
})

describe('moving', () => {
  beforeEach(() => { store.edit({ turn: 1, moves: [{ character: 'alice', to: 'street', position: 'by the lamp' }] }) })
  const where = (key: string) => store.placements.get('character', idOf(key))

  it('puts a character where it was sent, with the position and feature given, replacing where it was', () => {
    expect(where('alice')).toMatchObject({ locationId: place('street').id, position: 'by the lamp' })
    expect(store.move(idOf('alice'), { to: place('bar').id, position: 'at the end', featureKey: 'counter' })).toEqual({ from: place('street').id, to: place('bar').id, via: [place('bar').id], travelSeconds: 20 })
    expect(where('alice')).toMatchObject({ locationId: place('bar').id, position: 'at the end', featureKey: 'counter' })
    expect(store.placements.at(place('bar').id, 'character').map(entry => entry.entityId)).toEqual([idOf('alice')])
    expect(store.placements.at(place('street').id)).toEqual([])
  })

  it('goes through places on the way, over open exits only, and reports the time when every exit has one', () => {
    store.edit({ turn: 1, places: [{ key: 'lane', name: 'Lane', parent: 'town', exits: [{ to: 'street', travelSeconds: 40 }] }] })
    const plan = store.planMove(idOf('alice'), { to: place('lane').id })
    expect(plan).toEqual({ ok: true, plan: { from: place('street').id, to: place('lane').id, via: [place('lane').id], travelSeconds: 40 } })
    store.edit({ turn: 1, moves: [{ character: 'bob', to: 'lane' }] })
    store.move(idOf('bob'), { to: place('bar').id })
    expect(store.planMove(idOf('bob'), { to: place('lane').id })).toMatchObject({ ok: true, plan: { via: [place('street').id, place('lane').id] } })
  })

  it('places a character that is in no place without asking whether it knows the place: it is not travelling', () => {
    const drifter = store.characters.add(newCharacter({ sourceId: 'drifter', name: 'Drifter', aliases: [] }))
    expect(store.placements.get('character', drifter.id)).toBeUndefined()
    expect(store.planKnownMove(drifter.id, { to: place('bar').id })).toMatchObject({ ok: true })
  })

  it('plans a character\'s intended route only over places and directed exits it knows', () => {
    const alice = idOf('alice')
    const bar = place('bar')
    const street = place('street')
    expect(store.planKnownMove(alice, { to: bar.id })).toEqual({ ok: false, problems: [`the character does not know place ${bar.id}`] })
    store.knowledge.learn(alice, 'location', bar.id, 2)
    expect(store.planKnownMove(alice, { to: bar.id })).toEqual({ ok: false, problems: ['there is no way from Main Street to The Bar'] })
    store.knowledge.learn(alice, 'exit', store.locations.getExit(street.id, bar.id)!.id, 2)
    expect(store.planKnownMove(alice, { to: bar.id })).toMatchObject({ ok: true, plan: { via: [bar.id] } })
    expect(store.planKnownMove(alice, { to: place('quarry').id, ignoreExits: true })).toMatchObject({ ok: true })
  })

  it('refuses a way that is locked, saying where and why, and one that does not exist', () => {
    store.move(idOf('alice'), { to: place('bar').id })
    const locked = store.planMove(idOf('alice'), { to: place('cellar').id })
    expect(locked).toEqual({ ok: false, problems: ['the way from The Bar to Cellar is locked at The Bar -> Cellar: needs the brass key'] })
    expect(() => store.move(idOf('alice'), { to: place('cellar').id })).toThrow(InvalidMoveError)
    expect(where('alice')?.locationId).toBe(place('bar').id)
    expect(store.planMove(idOf('alice'), { to: place('quarry').id })).toEqual({ ok: false, problems: ['there is no way from The Bar to Quarry'] })
  })

  it('lets the story carry a character past the exits, and into a place when it stands nowhere yet', () => {
    expect(store.move(idOf('alice'), { to: place('quarry').id, ignoreExits: true })).toMatchObject({ to: place('quarry').id, via: [place('quarry').id] })
    expect(where('bob')).toBeUndefined()
    store.move(idOf('bob'), { to: place('cellar').id })
    expect(where('bob')?.locationId).toBe(place('cellar').id)
  })

  it('changes only the position when the destination is where it already is, and keeps it when none is given', () => {
    store.move(idOf('alice'), { to: place('street').id, position: 'by the bar door' })
    expect(where('alice')).toMatchObject({ locationId: place('street').id, position: 'by the bar door' })
    store.move(idOf('alice'), { to: place('street').id })
    expect(where('alice')?.position).toBe('by the bar door')
  })

  it('refuses a feature the place does not have, naming those it has', () => {
    expect(store.planMove(idOf('alice'), { to: place('bar').id, featureKey: 'piano' })).toEqual({ ok: false, problems: ['The Bar has no feature "piano" (it has: counter)'] })
    expect(store.planMove(idOf('alice'), { to: 999 })).toEqual({ ok: false, problems: ['there is no place 999'] })
  })
})

describe('the edit', () => {
  it('opens a way when a door is unlocked, in both directions unless one way, and refuses a way that does not exist', () => {
    expect(problemsOf({ turn: 2, exitChanges: [{ from: 'bar', to: 'cellar', state: 'open', note: '' }] })).toEqual([])
    expect(store.locations.getExit(place('cellar').id, place('bar').id)?.state).toBe('open')
    expect(problemsOf({ turn: 2, exitChanges: [{ from: 'bar', to: 'cellar', state: 'blocked', oneWay: true }] })).toEqual([])
    expect(store.locations.getExit(place('bar').id, place('cellar').id)?.state).toBe('blocked')
    expect(store.locations.getExit(place('cellar').id, place('bar').id)?.state).toBe('open')
    expect(problemsOf({ turn: 2, exitChanges: [{ from: 'bar', to: 'quarry', state: 'open' }] })).toEqual(['exit_changes[0]: there is no exit from "bar" to "quarry"'])
  })

  it('names every problem with places at once, and writes nothing', () => {
    const problems = problemsOf({
      turn: 2,
      places: [{ key: 'bar', name: 'Dup' }, { key: 'x', name: ' ' }, { key: 'y', name: 'Y', parent: 'nowhere', exits: [{ to: 'ghost' }, { to: 'y' }, { to: 'bar', state: 'ajar' as never }] }],
      moves: [{ character: 'carol', to: 'bar' }, { character: 'alice', to: 'ghost' }],
      events: [{ turn: 2, round: 1, text: 'Something.', importance: 2, location: 'ghost' }],
    })
    expect(problems.join('\n')).toMatch(/places\[0\]: the key "bar" is already used/)
    expect(problems.join('\n')).toMatch(/places\[1\]: give the place a name/)
    expect(problems.join('\n')).toMatch(/places\[2\]\.parent: there is no place "nowhere"/)
    expect(problems.join('\n')).toMatch(/exits\[0\]: there is no place "ghost"/)
    expect(problems.join('\n')).toMatch(/exits\[1\]: an exit must lead to another place/)
    expect(problems.join('\n')).toMatch(/unknown state "ajar"/)
    expect(problems.join('\n')).toMatch(/there is no character "carol"/)
    expect(problems.join('\n')).toMatch(/moves\[1\]\.to: there is no place "ghost"/)
    expect(problems.join('\n')).toMatch(/events\[0\]\.location: there is no place "ghost"/)
    expect(store.locations.list()).toHaveLength(5)
  })

  it('rolls everything back when a move turns out impossible, with the reasons', () => {
    store.edit({ turn: 2, moves: [{ character: 'alice', to: 'bar' }] })
    const problems = problemsOf({ turn: 2, threadsOpened: ['must not stay'], moves: [{ character: 'alice', to: 'cellar' }] })
    expect(problems[0]).toMatch(/^moves\[0\]: the way from The Bar to Cellar is locked/)
    expect(store.threads.list('open')).toEqual([])
  })

  it('lets an event be written in a place made in the same edit, and a place be edited and described again', () => {
    const result = store.edit({
      turn: 2,
      places: [{ key: 'passage', name: 'Hidden passage', parent: 'cellar', exits: [{ to: 'cellar', description: 'a gap behind the barrels' }] }],
      events: [{ turn: 2, round: 1, text: 'Alice found a hidden passage.', importance: 4, location: 'passage', involves: ['alice'] }],
      placeEdits: [{ place: 'bar', description: 'Quiet now.', name: 'The Old Bar' }],
    })
    expect(store.events.get(result.eventIds[0]!)?.locationId).toBe(place('passage').id)
    expect(store.locations.get(place('bar').id)).toMatchObject({ name: 'The Old Bar', description: 'Quiet now.' })
  })
})

describe('reading the records back', () => {
  it('shows where each character is and where each event happened, by key', () => {
    store.edit({
      turn: 2,
      moves: [{ character: 'alice', to: 'bar', position: 'at the counter', feature: 'counter' }],
      events: [{ turn: 2, round: 1, text: 'Alice ordered a drink.', importance: 2, location: 'bar', involves: ['alice'] }],
    })
    const view = store.records()
    expect(view.characters.find(entry => entry.character === 'alice')).toMatchObject({ location: 'bar', position: 'at the counter' })
    expect(view.characters.find(entry => entry.character === 'bob')).toMatchObject({ location: null, position: '' })
    expect(view.events[0]).toMatchObject({ location: 'bar' })
  })
})

describe('what happened where', () => {
  const happened = (text: string, location: string, who = 'alice') => store.edit({
    turn: 2, events: [{ turn: 2, round: 1, text, importance: 3, location, involves: [who], perceivedBy: [{ character: who, mode: 'witnessed' }] }],
  }, { seal: true }).eventIds[0]!

  it('is found by the name of the place, filtered by it, and follows a rename', () => {
    const inBar = happened('A glass was dropped.', 'bar')
    happened('A cart tipped over.', 'street')
    expect(store.recallIndex.lexical({ text: 'bar', kinds: ['event'], limit: 5 }).map(hit => hit.refId)).toEqual([inBar])
    expect(store.events.list({ locationId: place('street').id })).toHaveLength(1)
    expect(store.searchEvents({ text: 'glass', locationId: place('street').id })).toEqual([])
    expect(store.searchEvents({ text: 'glass', locationId: place('bar').id }).map(event => event.id)).toEqual([inBar])
    store.locations.update(place('bar').id, { name: 'Tavern' })
    expect(store.recallIndex.lexical({ text: 'tavern', kinds: ['event'], limit: 5 }).map(hit => hit.refId)).toEqual([inBar])
    expect(store.recallIndex.lexical({ text: 'bar', kinds: ['event'], limit: 5 })).toEqual([])
  })

  it('comes back to a character who is there, more readily than the same thing from elsewhere', () => {
    happened('Something odd happened.', 'bar')
    happened('Something odd happened.', 'street')
    const query = (locationId?: number) => ({ characterId: idOf('alice'), situation: 'Nothing in particular.', turn: 3, policy: { ...DEFAULT_MEMORY_POLICY, recall: 1, flaky: false }, ...(locationId === undefined ? {} : { locationId }) })
    const events = store.events.perceivedBy(idOf('alice'))
    const recalled = store.recall(query(place('street').id))
    expect(recalled).toHaveLength(1)
    expect(recalled[0]?.source.id).toBe(events.find(entry => entry.event.locationId === place('street').id)?.perception.id)
  })
})

describe('the wire format of places', () => {
  it('reads places, place edits, exit changes, moves and the location of events, and offers them in the schema', () => {
    const parsed = parseRecordsEdit({
      turn: 3,
      places: [{ key: 'attic', name: 'Attic', parent: 'bar', features: [{ key: 'chest', name: 'Chest' }], exits: [{ to: 'bar', one_way: true, travel_time_seconds: 5, state: 'locked', note: 'n', back_description: 'b' }] }],
      place_edits: [{ place: 'bar', description: 'd' }],
      exit_changes: [{ from: 'bar', to: 'attic', state: 'open', one_way: true }],
      moves: [{ character: 'alice', to: 'attic', position: 'p', feature: 'chest', ignore_exits: true }],
      events: [{ turn: 3, round: 1, text: 't', importance: 2, location: 'attic' }],
    })
    expect(parsed.places).toEqual([{ key: 'attic', name: 'Attic', parent: 'bar', features: [{ key: 'chest', name: 'Chest' }], exits: [{ to: 'bar', oneWay: true, travelSeconds: 5, state: 'locked', note: 'n', backDescription: 'b' }] }])
    expect(parsed.placeEdits).toEqual([{ place: 'bar', description: 'd' }])
    expect(parsed.exitChanges).toEqual([{ from: 'bar', to: 'attic', state: 'open', oneWay: true }])
    expect(parsed.moves).toEqual([{ character: 'alice', to: 'attic', position: 'p', feature: 'chest', ignoreExits: true }])
    expect(parsed.events?.[0]?.location).toBe('attic')
    expect(Object.keys(recordsEditSchema().properties ?? {})).toEqual(expect.arrayContaining(['place_edits', 'exit_changes', 'moves']))
    expect(Object.keys(recordsEditSchema().properties ?? {})).not.toContain('places')
    expect(Object.keys(recordsEditSchema({ authoring: true }).properties ?? {})).toEqual(expect.arrayContaining(['places', 'exits', 'characters']))
  })
})
