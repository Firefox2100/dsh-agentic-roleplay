import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ConflictError, InvalidValueError, NotFoundError, type CharacterId, type EventId, type NewPerception, type SessionStore } from '../../src/index.ts'
import { concealmentProblems, deriveVerdict, knowsEvent, readClaims, verdictFor } from '../../src/records/claims.ts'
import { memoryStore, newCharacter } from '../helpers.ts'

let store: SessionStore
let holmes: CharacterId
let helen: CharacterId
let crowd: CharacterId
let bystander: CharacterId

beforeEach(() => {
  store = memoryStore()
  holmes = store.characters.add(newCharacter({ sourceId: 'holmes', name: 'Holmes', aliases: [] })).id
  helen = store.characters.add(newCharacter({ sourceId: 'helen', name: 'Helen', aliases: [] })).id
  crowd = store.characters.add(newCharacter({ sourceId: 'crowd', name: 'The crowd', aliases: [], kind: 'group' })).id
  bystander = store.characters.add(newCharacter({ sourceId: 'bystander', name: 'A bystander', aliases: [] })).id
})
afterEach(() => { store.close() })

const saw = (characterId: CharacterId): NewPerception => ({ characterId, mode: 'witnessed', content: 'It happened.', gist: 'It happened', accuracy: 'accurate' })
const happen = (turn: number, text: string, ...seen: CharacterId[]): EventId => store.events.add({ turn, round: 1, text, importance: 3, tags: [], involves: seen }, seen.map(saw)).event.id

describe('deriveVerdict', () => {
  it('reads decisive and weighing links', () => {
    expect(deriveVerdict([])).toBe('unresolved')
    expect(deriveVerdict(['confirms'])).toBe('true')
    expect(deriveVerdict(['contradicts'])).toBe('false')
    expect(deriveVerdict(['confirms', 'contradicts'])).toBe('disputed')
    expect(deriveVerdict(['supports'])).toBe('likely')
    expect(deriveVerdict(['undermines'])).toBe('unlikely')
    expect(deriveVerdict(['supports', 'undermines'])).toBe('open')
    expect(deriveVerdict(['supports', 'confirms'])).toBe('true')
  })
})

describe('claims', () => {
  it('stores a claim with who made it, where, and its links', () => {
    const told = happen(1, 'Helen tells the cause.', helen, holmes)
    const proof = happen(2, 'The snake is found.', holmes)
    const claim = store.claims.add({ text: 'Julia died of fear.', byCharacterId: helen, assertedEventId: told, createdTurn: 1, links: [{ eventId: proof, bearing: 'contradicts', part: '' }] })
    expect(claim).toMatchObject({ status: 'proposed', byLabel: '', assertedEventId: told, links: [{ eventId: proof, bearing: 'contradicts', part: '' }] })
    expect(store.claims.setStatus(claim.id, 'confirmed').status).toBe('confirmed')
    expect(store.claims.list({ status: 'proposed' })).toEqual([])
    expect(store.claims.unlink(claim.id, proof).links).toEqual([])
  })

  it('refuses empty words, unknown references and links to a part the claim lacks', () => {
    const e = happen(1, 'Something.', helen)
    expect(() => store.claims.add({ text: '  ', createdTurn: 1 })).toThrow(InvalidValueError)
    expect(() => store.claims.add({ text: 'x', byCharacterId: 999, createdTurn: 1 })).toThrow(NotFoundError)
    expect(() => store.claims.add({ text: 'x', assertedEventId: 999, createdTurn: 1 })).toThrow(NotFoundError)
    expect(() => store.claims.add({ text: 'x', createdTurn: 1, links: [{ eventId: e, bearing: 'supports', part: 'second' }] })).toThrow(InvalidValueError)
    const claim = store.claims.add({ text: 'x', createdTurn: 1 })
    expect(() => store.claims.link(claim.id, { eventId: 999, bearing: 'supports', part: '' })).toThrow(NotFoundError)
  })

  it('has one link per event and part: the later replaces the earlier', () => {
    const e = happen(1, 'Something.', helen)
    const claim = store.claims.add({ text: 'x', createdTurn: 1 })
    store.claims.link(claim.id, { eventId: e, bearing: 'supports', part: '' })
    expect(store.claims.link(claim.id, { eventId: e, bearing: 'contradicts', part: '' }).links).toEqual([{ eventId: e, bearing: 'contradicts', part: '' }])
  })
})

describe('verdicts', () => {
  it('count a link only once the claim is made and the event known', () => {
    const made = happen(1, 'Holmes says the shutters are the way in.', holmes)
    const tested = happen(2, 'The shutters hold.', holmes)
    const claim = store.claims.add({ text: 'The shutters let something in.', byCharacterId: holmes, assertedEventId: made, createdTurn: 1, links: [{ eventId: tested, bearing: 'contradicts', part: '' }] })
    const verdictAt = (at?: EventId) => readClaims(store, at === undefined ? {} : { at }).find(reading => reading.claim.id === claim.id)?.verdict
    expect(verdictAt(made)).toBe('unresolved')
    expect(verdictAt(tested)).toBe('false')
    expect(verdictAt()).toBe('false')
  })

  it('are mixed when the parts of a claim have different fates', () => {
    const e1 = happen(1, 'The ventilator is found.', holmes)
    const claim = store.claims.add({
      text: 'Nothing could get in and the rooms are separate.', createdTurn: 1,
      parts: [{ key: 'sealed', text: 'Nothing could get in.' }, { key: 'separate', text: 'The rooms are separate.' }],
      links: [{ eventId: e1, bearing: 'contradicts', part: 'separate' }],
    })
    expect(readClaims(store).find(reading => reading.claim.id === claim.id)?.verdict).toBe('mixed')
  })

  it('let a rival that is true or likely weigh on the others, and never the other way', () => {
    const e1 = happen(1, 'The lash is seen.', holmes)
    const e2 = happen(2, 'The shutters hold.', holmes)
    const snake = store.claims.add({ text: 'A snake did it.', createdTurn: 1, links: [{ eventId: e1, bearing: 'supports', part: '' }] })
    const fear = store.claims.add({ text: 'Fear did it.', createdTurn: 1 })
    const gypsies = store.claims.add({ text: 'The gypsies did it.', createdTurn: 1, links: [{ eventId: e2, bearing: 'undermines', part: '' }] })
    store.claims.addQuestion('What killed Julia?', [snake.id, fear.id, gypsies.id])
    const verdicts = Object.fromEntries(readClaims(store).map(reading => [reading.claim.id, reading.verdict]))
    expect(verdicts).toEqual({ [snake.id]: 'likely', [fear.id]: 'unlikely', [gypsies.id]: 'unlikely' })
  })

  it('hold a question to two to four rivals', () => {
    const claims = Array.from({ length: 5 }, (_, i) => store.claims.add({ text: `claim ${i}`, createdTurn: 1 }).id)
    expect(() => store.claims.addQuestion('q', [claims[0]!])).toThrow(InvalidValueError)
    expect(() => store.claims.addQuestion('q', claims)).toThrow(InvalidValueError)
    expect(() => store.claims.addQuestion('q', [claims[0]!, 999])).toThrow(NotFoundError)
    expect(store.claims.addQuestion('q', claims.slice(0, 4)).rivals).toHaveLength(4)
  })

  it('show one character only what it took in, rivals included', () => {
    const lash = happen(1, 'The lash is seen.', holmes)
    const shutters = happen(2, 'The shutters hold.', helen, holmes)
    const snake = store.claims.add({ text: 'A snake did it.', createdTurn: 1, links: [{ eventId: lash, bearing: 'supports', part: '' }] })
    const gypsies = store.claims.add({ text: 'The gypsies did it.', createdTurn: 1, links: [{ eventId: shutters, bearing: 'undermines', part: '' }] })
    store.claims.addQuestion('What killed Julia?', [snake.id, gypsies.id])
    expect(verdictFor(store, gypsies.id, holmes)).toBe('unlikely')
    expect(verdictFor(store, snake.id, helen)).toBe('unresolved')
    expect(verdictFor(store, snake.id, holmes)).toBe('likely')
    expect(verdictFor(store, 999, holmes)).toBeUndefined()
  })
})

describe('who took an event in', () => {
  it('is yes for a perceiver, possibly for a member of a group that took it in, no otherwise', () => {
    const leap = happen(1, 'The dog leaps ashore.', crowd)
    store.groups.include(crowd, bystander)
    expect(knowsEvent(store, crowd, leap)).toBe('knows')
    expect(knowsEvent(store, bystander, leap)).toBe('possibly')
    expect(knowsEvent(store, holmes, leap)).toBe('no')
  })

  it('follows groups inside groups and refuses circles', () => {
    const outer = store.characters.add(newCharacter({ sourceId: 'town', name: 'The town', aliases: [], kind: 'group' })).id
    store.groups.include(outer, crowd)
    store.groups.include(crowd, bystander)
    expect(store.groups.groupsOf(bystander)).toEqual([crowd, outer].sort((a, b) => a - b))
    expect(() => store.groups.include(bystander, crowd)).toThrow(ConflictError)
    expect(() => store.groups.include(crowd, outer)).toThrow(ConflictError)
    expect(() => store.groups.include(crowd, crowd)).toThrow(InvalidValueError)
    expect(store.groups.exclude(crowd, bystander)).toBe(true)
    expect(store.groups.groupsOf(bystander)).toEqual([])
  })

  it('is no for a character the event was kept from, whatever its group saw', () => {
    const hid = happen(1, 'The letter is hidden.', crowd)
    store.groups.include(crowd, bystander)
    store.concealment.hide(hid, bystander)
    expect(knowsEvent(store, bystander, hid)).toBe('no')
    expect(store.concealment.hiddenFrom(hid)).toEqual([bystander])
    expect(store.concealment.hiddenEvents(bystander)).toEqual([hid])
    expect(concealmentProblems(store)).toEqual([])
    store.events.addPerception(hid, saw(bystander))
    expect(concealmentProblems(store)).toEqual([`event ${hid} is hidden from character ${bystander}, who also took it in`])
    expect(store.concealment.reveal(hid, bystander)).toBe(true)
    expect(concealmentProblems(store)).toEqual([])
  })
})
