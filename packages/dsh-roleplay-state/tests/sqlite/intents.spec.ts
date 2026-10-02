import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { InvalidValueError, NotFoundError, type CharacterId, type SessionStore } from '../../src/index.ts'
import { memoryStore, newCharacter, newIntent } from '../helpers.ts'

let store: SessionStore
let id: CharacterId

beforeEach(() => {
  store = memoryStore()
  id = store.characters.add(newCharacter()).id
})
afterEach(() => { store.close() })

describe('IntentRepository', () => {
  it('stores an intent and reads it back as the canonical model', () => {
    const added = store.intents.add(id, newIntent())
    expect(added).toEqual({
      id: 1,
      characterId: id,
      ...newIntent(),
      createdAt: '2026-01-01T00:00:03.000Z',
      updatedAt: '2026-01-01T00:00:03.000Z',
    })
    expect(store.intents.get(added.id)).toEqual(added)
    expect(store.intents.get(99)).toBeUndefined()
  })

  it('leaves out a deadline that is not set', () => {
    expect(store.intents.add(id, newIntent({ deadline: undefined }))).not.toHaveProperty('deadline')
  })

  it('needs an existing character', () => {
    expect(() => store.intents.add(99, newIntent())).toThrow(NotFoundError)
  })

  it('lists one character\'s intents in creation order, optionally by status', () => {
    const other = store.characters.add(newCharacter({ sourceId: 'other', name: 'Other' })).id
    store.intents.add(id, newIntent({ name: 'first' }))
    store.intents.add(id, newIntent({ name: 'second', status: 'completed' }))
    store.intents.add(other, newIntent({ name: 'not mine' }))
    expect(store.intents.list(id).map(intent => intent.name)).toEqual(['first', 'second'])
    expect(store.intents.list(id, { status: 'completed' }).map(intent => intent.name)).toEqual(['second'])
    expect(store.intents.list(99)).toEqual([])
  })

  describe('update', () => {
    it('changes only the fields given and the update time', () => {
      const { id: intentId } = store.intents.add(id, newIntent())
      const updated = store.intents.update(intentId, { status: 'paused', plan: ['Wait'] })
      expect(updated).toMatchObject({ ...newIntent(), status: 'paused', plan: ['Wait'], createdAt: '2026-01-01T00:00:03.000Z' })
      expect(updated.updatedAt > updated.createdAt).toBe(true)
    })

    it('sets and removes a deadline', () => {
      const { id: intentId } = store.intents.add(id, newIntent({ deadline: undefined }))
      expect(store.intents.update(intentId, { deadline: '1912-09-23T00:00:00.000Z' }).deadline).toBe('1912-09-23T00:00:00.000Z')
      expect(store.intents.update(intentId, { deadline: null })).not.toHaveProperty('deadline')
    })

    it('fails for an unknown intent or an invalid value, keeping the old one', () => {
      const { id: intentId } = store.intents.add(id, newIntent())
      expect(() => store.intents.update(99, { name: 'x' })).toThrow(NotFoundError)
      expect(() => store.intents.update(intentId, { priority: 2 })).toThrow(InvalidValueError)
      expect(store.intents.get(intentId)?.priority).toBe(0.8)
    })
  })

  it('removes an intent', () => {
    const { id: intentId } = store.intents.add(id, newIntent())
    expect(store.intents.remove(intentId)).toBe(true)
    expect(store.intents.remove(intentId)).toBe(false)
    expect(store.intents.get(intentId)).toBeUndefined()
  })
})
