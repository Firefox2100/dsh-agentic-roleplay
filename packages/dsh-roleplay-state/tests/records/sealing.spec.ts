import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ConflictError, InvalidEditError, type RecordsEdit, type SessionStore } from '../../src/index.ts'
import { memoryStore, newCharacter } from '../helpers.ts'

let store: SessionStore
beforeEach(() => {
  store = memoryStore()
  for (const [sourceId, name] of [['alice', 'Alice'], ['bob', 'Bob'], ['carol', 'Carol']] as const) store.characters.add(newCharacter({ sourceId, name, aliases: [] }))
})
afterEach(() => { store.close() })

const idOf = (key: string) => store.characters.getBySourceId(key)!.id
const problemsOf = (change: RecordsEdit): string[] => {
  try { store.edit(change) } catch (error) { if (error instanceof InvalidEditError) return [...error.problems]; throw error }
  return []
}
const written = (options?: { seal?: boolean }) => store.edit({
  turn: 1,
  events: [{ turn: 1, round: 1, text: 'Bob hid the key.', importance: 3, tags: ['key'], involves: ['bob'], perceivedBy: [{ character: 'bob', mode: 'witnessed' }, { character: 'alice', mode: 'witnessed' }] }],
}, options).eventIds[0]!

describe('events are final once sealed', () => {
  it('start as drafts that their writer may correct or retract, and are sealed together', () => {
    const id = written()
    expect(store.events.get(id)?.sealed).toBe(false)
    expect(problemsOf({ turn: 1, eventEdits: [{ id, text: 'Bob hid the lantern.' }] })).toEqual([])
    expect(store.events.get(id)?.text).toBe('Bob hid the lantern.')
    expect(store.events.seal()).toBe(1)
    expect(store.events.seal()).toBe(0)
    expect(store.events.get(id)?.sealed).toBe(true)
  })

  it('can be sealed at once by the edit that writes them', () => {
    expect(store.events.get(written({ seal: true }))?.sealed).toBe(true)
  })

  it('refuse any change to the event, and removal, with the reason, while the edit stays all-or-nothing', () => {
    const id = written({ seal: true })
    expect(() => store.events.update(id, { text: 'x' })).toThrow(ConflictError)
    expect(() => store.events.setPerceptions(id, [])).toThrow(ConflictError)
    expect(() => store.events.remove(id)).toThrow(ConflictError)
    const problems = problemsOf({ turn: 2, eventEdits: [{ id, importance: 5 }], eventRetractions: [id], threadsOpened: ['must not be written'] })
    expect(problems).toHaveLength(2)
    expect(problems[0]).toMatch(/sealed.*perception_edits/)
    expect(store.threads.list('open')).toEqual([])
    expect(store.events.get(id)).toMatchObject({ text: 'Bob hid the key.', importance: 3 })
  })

  it('seal only the ids given', () => {
    const first = written()
    const second = written()
    expect(store.events.seal([first])).toBe(1)
    expect(store.events.get(second)?.sealed).toBe(false)
  })
})

describe('what a character took in stays revisable', () => {
  it('revises a perception of a sealed event in place, keeping its recalls, and re-indexes its text', () => {
    const id = written({ seal: true })
    const [, alices] = store.events.perceptionsOf(id)
    store.events.touchPerceptions([alices!.id], 4)
    expect(store.edit({ turn: 3, perceptionEdits: [{ id: alices!.id, content: 'Bob hid the lantern.', accuracy: 'mistaken', mode: 'heard' }] }).writes).toBe(1)
    const revised = store.events.getPerception(alices!.id)
    expect(revised).toMatchObject({ id: alices!.id, content: 'Bob hid the lantern.', accuracy: 'mistaken', mode: 'heard', recalls: 1, gist: alices!.gist })
    const hits = (text: string) => store.recallIndex.lexical({ text, characterId: idOf('alice'), limit: 5 })
    expect(hits('lantern')).toHaveLength(1)
    expect(hits('lantern')[0]).toMatchObject({ key: `p:${alices!.id}` })
  })

  it('drops the vector of a perception whose content changes, so it is embedded again', () => {
    const id = written({ seal: true })
    const [, alices] = store.events.perceptionsOf(id)
    store.recallIndex.store('m', store.recallIndex.pending(10).map(item => ({ id: item.id, vector: [1, 0] })))
    expect(store.recallIndex.info()?.pending).toBe(0)
    store.edit({ turn: 3, perceptionEdits: [{ id: alices!.id, gist: 'only the gist' }] })
    expect(store.recallIndex.info()?.pending).toBe(0)
    store.edit({ turn: 3, perceptionEdits: [{ id: alices!.id, content: 'Something else entirely.' }] })
    expect(store.recallIndex.pending(10).map(item => item.text)).toEqual(['Something else entirely.'])
  })

  it('lets a character learn of an earlier event later, once, and refuses what makes no sense', () => {
    const id = written({ seal: true })
    expect(store.events.perceptionsOf(id).map(entry => entry.characterId)).toEqual([idOf('bob'), idOf('alice')])
    store.edit({ turn: 5, perceptionsAdded: [{ event: id, character: 'carol', mode: 'told', content: 'Bob stashed something.', accuracy: 'partial' }] })
    const carols = store.events.perceptionsOf(id).find(entry => entry.characterId === idOf('carol'))
    expect(carols).toMatchObject({ mode: 'told', content: 'Bob stashed something.', accuracy: 'partial' })
    expect(store.events.perceivedBy(idOf('carol'))).toHaveLength(1)
    const problems = problemsOf({
      turn: 5,
      perceptionsAdded: [{ event: id, character: 'carol', mode: 'told' }, { event: 99, character: 'bob', mode: 'told' }, { event: id, character: 'nobody', mode: 'told' }],
      perceptionEdits: [{ id: 999, content: 'x' }, { id: carols!.id, content: '  ' }],
    })
    expect(problems.join('\n')).toMatch(/already has a perception.*perception_edits/)
    expect(problems.join('\n')).toMatch(/there is no event 99/)
    expect(problems.join('\n')).toMatch(/there is no character "nobody"/)
    expect(problems.join('\n')).toMatch(/there is no perception 999/)
    expect(problems.join('\n')).toMatch(/content cannot be empty/)
    expect(() => store.events.addPerception(id, { characterId: idOf('carol'), mode: 'told', content: 'c', gist: 'c', accuracy: 'accurate' })).toThrow(ConflictError)
  })

  it('reads both from the wire format and shows ids and sealing when the records are read back', () => {
    const id = written({ seal: true })
    const view = store.records()
    expect(view.events[0]).toMatchObject({ id, sealed: true })
    expect(view.events[0]!.perceived_by.every(entry => typeof entry.id === 'number')).toBe(true)
  })
})

describe('the wire format of perceptions', () => {
  it('reads perception_edits and perceptions_added, and offers them in the schema for edits', async () => {
    const { parseRecordsEdit, recordsEditSchema } = await import('../../src/index.ts')
    const parsed = parseRecordsEdit({
      turn: 2,
      perception_edits: [{ id: 3, content: 'c', accuracy: 'mistaken' }],
      perceptions_added: [{ event: 1, character: 'carol', mode: 'told', gist: 'g' }],
    })
    expect(parsed.perceptionEdits).toEqual([{ id: 3, content: 'c', accuracy: 'mistaken' }])
    expect(parsed.perceptionsAdded).toEqual([{ event: 1, character: 'carol', mode: 'told', gist: 'g' }])
    expect(Object.keys(recordsEditSchema({ changes: true }).properties ?? {})).toEqual(expect.arrayContaining(['perception_edits', 'perceptions_added']))
    expect(Object.keys(recordsEditSchema().properties ?? {})).not.toContain('perception_edits')
  })
})
