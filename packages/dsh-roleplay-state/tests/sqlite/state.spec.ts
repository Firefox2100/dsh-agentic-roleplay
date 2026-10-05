import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ConflictError, NotFoundError, type CharacterId, type SessionStore } from '../../src/index.ts'
import { memoryStore, newCharacter } from '../helpers.ts'

let store: SessionStore
let id: CharacterId

beforeEach(() => {
  store = memoryStore()
  id = store.characters.add(newCharacter()).id
})
afterEach(() => { store.close() })

describe('CharacterStateRepository', () => {
  it('stores the state a character starts in', () => {
    const created = store.characterStates.create(id, {
      publicState: 'Greeting guests.',
      innerState: 'Wondering what the visitor wants.',
      activity: 'managing festival appearances',
    })
    expect(created).toEqual({
      characterId: id,
      publicState: 'Greeting guests.',
      innerState: 'Wondering what the visitor wants.',
      activity: 'managing festival appearances',
      version: 1,
      updatedAt: '2026-01-01T00:00:03.000Z',
    })
    expect(store.characterStates.get(id)).toEqual(created)
  })

  it('reports a missing state as undefined', () => {
    expect(store.characterStates.get(id)).toBeUndefined()
  })

  it('needs an existing character and creates a state only once', () => {
    expect(() => store.characterStates.create(99, { publicState: '', innerState: '', activity: '' })).toThrow(NotFoundError)
    store.characterStates.create(id, { publicState: '', innerState: '', activity: '' })
    expect(() => store.characterStates.create(id, { publicState: '', innerState: '', activity: '' })).toThrow(ConflictError)
  })

  describe('update', () => {
    beforeEach(() => {
      store.characterStates.create(id, { publicState: 'a', innerState: 'b', activity: 'c' })
    })

    it('changes only the fields given, bumping the version and the time', () => {
      const updated = store.characterStates.update(id, { activity: 'looking for the key' })
      expect(updated).toMatchObject({ publicState: 'a', innerState: 'b', activity: 'looking for the key', version: 2 })
      expect(updated.updatedAt > '2026-01-01T00:00:03.000Z').toBe(true)
      expect(store.characterStates.get(id)).toEqual(updated)
    })

    it('does nothing, not even a new version, for an empty patch', () => {
      expect(store.characterStates.update(id, {}).version).toBe(1)
    })

    it('applies only to the expected version', () => {
      store.characterStates.update(id, { activity: 'x' }, { expectedVersion: 1 })
      expect(() => store.characterStates.update(id, { activity: 'y' }, { expectedVersion: 1 })).toThrow(/version 2, not 1/)
      expect(() => store.characterStates.update(id, { activity: 'y' }, { expectedVersion: 1 })).toThrow(ConflictError)
      expect(store.characterStates.get(id)?.activity).toBe('x')
      expect(store.characterStates.update(id, { activity: 'z' }, { expectedVersion: 2 }).version).toBe(3)
    })

    it('fails for a character without a state', () => {
      expect(() => store.characterStates.update(99, { activity: 'x' })).toThrow(NotFoundError)
    })
  })
})
