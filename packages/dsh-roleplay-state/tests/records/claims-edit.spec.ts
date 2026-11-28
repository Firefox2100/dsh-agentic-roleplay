import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { InvalidEditError, parseRecordsEdit, readClaims, recordsEditSchema, type RecordsEdit, type SessionStore } from '../../src/index.ts'
import { memoryStore, newCharacter } from '../helpers.ts'

let store: SessionStore
beforeEach(() => {
  store = memoryStore()
  for (const [sourceId, name, kind] of [['holmes', 'Holmes', 'person'], ['helen', 'Helen', 'person'], ['crowd', 'The crowd', 'group'], ['stranger', 'A stranger', 'person']] as const) {
    const { id } = store.characters.add(newCharacter({ sourceId, name, aliases: [], kind }))
    store.characterStates.create(id, { publicState: name, innerState: '', activity: 'idle' })
  }
})
afterEach(() => { store.close() })

const edit = (overrides: Partial<RecordsEdit> = {}): RecordsEdit => ({ turn: 1, ...overrides })
const problemsOf = (change: RecordsEdit): string[] => {
  try { store.edit(change) } catch (error) { if (error instanceof InvalidEditError) return [...error.problems]; throw error }
  return []
}
const id = (key: string) => store.characters.getBySourceId(key)!.id
const happening = (text: string, who: string[] = ['holmes']) => ({ turn: 1, round: 1, text, importance: 3, perceivedBy: who.map(character => ({ character, mode: 'witnessed' as const })) })

describe('claims in a records edit', () => {
  it('records a claim with the event it is made in and the events that bear on it, all in one edit', () => {
    const result = store.edit(edit({
      events: [happening('Helen says her sister died of fear.', ['helen', 'holmes']), happening('The snake bites Roylott.')],
      claims: [{ text: 'Julia died of fear.', byCharacter: 'helen', assertedInNew: 0, links: [{ eventNew: 1, as: 'contradicts' }] }],
    }))
    expect(result.claimIds).toHaveLength(1)
    const [claim] = store.claims.list()
    expect(claim).toMatchObject({ byCharacterId: id('helen'), assertedEventId: result.eventIds[0], status: 'proposed', links: [{ eventId: result.eventIds[1], bearing: 'contradicts' }] })
    expect(readClaims(store)[0]?.verdict).toBe('false')
  })

  it('takes a claim by someone who is not a character, parts, and a rival set made with its claims', () => {
    const e = store.edit(edit({ events: [happening('The inquiry sits.')] })).eventIds[0]!
    const result = store.edit(edit({
      claims: [
        { text: 'He died of a pet.', byLabel: 'the inquiry', assertedIn: e, parts: [{ key: 'pet', text: 'A pet killed him.' }, { key: 'accident', text: 'It was an accident.' }] },
        { text: 'He was killed on purpose.', assertedIn: e },
      ],
      claimQuestions: [{ text: 'How did he die?', rivalsNew: [0, 1] }],
    }))
    expect(result.claimIds).toHaveLength(2)
    expect(store.claims.get(result.claimIds![0]!)).toMatchObject({ byLabel: 'the inquiry', parts: [{ key: 'pet' }, { key: 'accident' }] })
    expect(store.claims.questions()).toEqual([{ id: 1, text: 'How did he die?', rivals: result.claimIds }])
  })

  it('adds, changes, removes and settles links and claims later', () => {
    const [a, b] = store.edit(edit({ events: [happening('One.'), happening('Two.')] })).eventIds as [number, number]
    const claimId = store.edit(edit({ claims: [{ text: 'x', assertedIn: a }] })).claimIds![0]!
    store.edit(edit({ claimLinks: [{ claim: claimId, event: b, as: 'supports' }] }))
    store.edit(edit({ claimLinks: [{ claim: claimId, event: b, as: 'confirms' }] }))
    expect(store.claims.get(claimId)?.links).toEqual([{ eventId: b, bearing: 'confirms', part: '' }])
    store.edit(edit({ claimStatuses: [{ claim: claimId, status: 'confirmed' }] }))
    expect(store.claims.get(claimId)?.status).toBe('confirmed')
    store.edit(edit({ claimUnlinks: [{ claim: claimId, event: b }] }))
    expect(store.claims.get(claimId)?.links).toEqual([])
    store.edit(edit({ claimRetractions: [claimId] }))
    expect(store.claims.list()).toEqual([])
  })

  it('records who an event was kept from, and who may have been in a group', () => {
    const e = store.edit(edit({ events: [happening('The letter is hidden.', ['holmes'])] })).eventIds[0]!
    store.edit(edit({ concealments: [{ event: e, from: 'helen' }], groupMembers: [{ group: 'crowd', member: 'stranger' }] }))
    expect(store.concealment.hiddenFrom(e)).toEqual([id('helen')])
    expect(store.groups.members(id('crowd'))).toEqual([id('stranger')])
    store.edit(edit({ concealments: [{ event: e, from: 'helen', lift: true }], groupMembers: [{ group: 'crowd', member: 'stranger', remove: true }] }))
    expect(store.concealment.hiddenFrom(e)).toEqual([])
    expect(store.groups.members(id('crowd'))).toEqual([])
  })

  it('refuses every problem at once and writes nothing', () => {
    const e = store.edit(edit({ events: [happening('One.')] })).eventIds[0]!
    const problems = problemsOf(edit({
      events: [happening('Two.')],
      claims: [
        { text: ' ', byCharacter: 'nobody' },
        { text: 'y', assertedIn: 99, parts: [{ key: 'right', text: 'the other half' }], links: [{ event: e, eventNew: 0, as: 'supports' }, { event: e, as: 'maybe' as never }, { event: e, as: 'supports', part: 'left' }] },
      ],
      claimLinks: [{ claim: 99, event: e, as: 'supports' }],
      claimQuestions: [{ text: 'q', rivalsNew: [0] }, { text: 'r', rivals: [1, 2, 3, 4, 5] }],
      concealments: [{ event: 99, from: 'helen' }],
      groupMembers: [{ group: 'crowd', member: 'crowd' }],
    }))
    expect(problems).toEqual(expect.arrayContaining([
      expect.stringContaining('claims[0]: a claim needs its words'),
      expect.stringContaining('there is no character "nobody"'),
      expect.stringContaining('claims[1].asserted_in: there is no event 99'),
      expect.stringContaining('claims[1].links[0]: name the event by'),
      expect.stringContaining('claims[1].links[1]: "as" must be one of'),
      expect.stringContaining('the claim has no part "left"'),
      expect.stringContaining('claim_links[0]: there is no claim 99'),
      expect.stringContaining('claim_questions[0]: a question holds 2 to 4 rival claims'),
      expect.stringContaining('claim_questions[1]: there is no claim 1'),
      expect.stringContaining('concealments[0]: there is no event 99'),
      expect.stringContaining('group_members[0]: a group cannot include itself'),
    ]))
    expect(store.events.list()).toHaveLength(1)
    expect(store.claims.list()).toEqual([])
  })

  it('ignores a part named for a claim that has none, and keeps one that does', () => {
    const e = store.edit(edit({ events: [happening('One.'), happening('Two.')] })).eventIds as [number, number]
    const plain = store.edit(edit({ claims: [{ text: 'x', links: [{ event: e[0], as: 'supports', part: 'text' }] }] })).claimIds![0]!
    expect(store.claims.get(plain)?.links).toEqual([{ eventId: e[0], bearing: 'supports', part: '' }])
    store.edit(edit({ claimLinks: [{ claim: plain, event: e[1], as: 'undermines', part: 'x' }] }))
    expect(store.claims.get(plain)?.links.map(link => link.part)).toEqual(['', ''])
    const halves = store.edit(edit({ claims: [{ text: 'y', parts: [{ key: 'a', text: 'a' }], links: [{ event: e[0], as: 'supports', part: 'a' }] }] })).claimIds![0]!
    expect(store.claims.get(halves)?.links).toEqual([{ eventId: e[0], bearing: 'supports', part: 'a' }])
  })

  it('refuses to count the event where a claim is made as evidence for it', () => {
    const made = store.edit(edit({ events: [happening('Helen says it was fear.', ['helen', 'holmes'])] })).eventIds[0]!
    expect(problemsOf(edit({ events: [happening('Two.')], claims: [{ text: 'It was fear.', assertedInNew: 0, links: [{ eventNew: 0, as: 'confirms' }] }] }))).toEqual(['claims[0].links[0]: the event in which the claim is made is not evidence for it'])
    expect(problemsOf(edit({ claims: [{ text: 'It was fear.', assertedIn: made, links: [{ event: made, as: 'supports' }] }] }))).toEqual(['claims[0].links[0]: the event in which the claim is made is not evidence for it'])
    const claim = store.edit(edit({ claims: [{ text: 'It was fear.', assertedIn: made }] })).claimIds![0]!
    expect(problemsOf(edit({ claimLinks: [{ claim, event: made, as: 'supports' }] }))).toEqual(['claim_links[0]: the event in which the claim is made is not evidence for it'])
  })

  it('parses the wire format and offers the settling of a claim only when asked', () => {
    const parsed = parseRecordsEdit({ turn: 2, claims: [{ text: 'x', by_character: 'helen', asserted_in_new: 0, links: [{ event: 3, as: 'supports', part: 'a' }], parts: [{ key: 'a', text: 'half' }] }], claim_statuses: [{ claim: 1, status: 'confirmed' }], claim_questions: [{ text: 'q', rivals: [1, 2], rivals_new: [0] }], concealments: [{ event: 1, from: 'helen', lift: true }], group_members: [{ group: 'crowd', member: 'stranger' }] })
    expect(parsed).toMatchObject({
      claims: [{ text: 'x', byCharacter: 'helen', assertedInNew: 0, links: [{ event: 3, as: 'supports', part: 'a' }], parts: [{ key: 'a', text: 'half' }] }],
      claimStatuses: [{ claim: 1, status: 'confirmed' }], claimQuestions: [{ text: 'q', rivals: [1, 2], rivalsNew: [0] }], concealments: [{ event: 1, from: 'helen', lift: true }], groupMembers: [{ group: 'crowd', member: 'stranger' }],
    })
    const item = (confirming: boolean) => (recordsEditSchema({ confirming }).properties as Record<string, any>)['claims'].items.properties
    expect(item(false)).not.toHaveProperty('status')
    expect(item(true)).toHaveProperty('status')
  })
})

describe('a claim written twice', () => {
  it('is refused with the claim it repeats, whether recorded before or earlier in the same edit, and a different author or wording is fine', () => {
    const first = store.edit(edit({ events: [happening('Holmes says the prints are the doctor\'s.')], claims: [{ text: 'The prints are the doctor\'s.', byCharacter: 'holmes', assertedInNew: 0 }] }))
    const id = first.claimIds![0]!
    expect(problemsOf(edit({ claims: [{ text: 'the prints are the DOCTOR\'S', byCharacter: 'holmes' }] }))[0]).toContain(`claim ${id}`)
    expect(problemsOf(edit({ claims: [{ text: 'The prints are the doctor\'s.', byCharacter: 'helen' }] }))).toEqual([])
    expect(problemsOf(edit({ claims: [{ text: 'A new theory.', byCharacter: 'holmes' }, { text: 'a new theory', byCharacter: 'holmes' }] }))[0]).toContain('earlier in this edit')
  })
})
