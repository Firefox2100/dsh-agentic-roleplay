import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ConflictError, InvalidValueError, NotFoundError, type CharacterId, type SessionStore } from '../../src/index.ts'
import { memoryStore, newCharacter } from '../helpers.ts'

let store: SessionStore
let id: CharacterId

const emotion = {
  baseline: { valence: -0.1, arousal: 0.3, dominance: 0.5 },
  immediate: { valence: -0.3, arousal: 0.4, dominance: 0.5 },
}

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
      emotion,
    })
    expect(created).toEqual({
      characterId: id,
      publicState: 'Greeting guests.',
      innerState: 'Wondering what the visitor wants.',
      activity: 'managing festival appearances',
      emotion,
      version: 1,
      updatedAt: '2026-01-01T00:00:03.000Z',
    })
    expect(store.characterStates.get(id)).toEqual(created)
  })

  it('has no emotion unless one is given', () => {
    const created = store.characterStates.create(id, { publicState: '', innerState: '', activity: '' })
    expect(created).not.toHaveProperty('emotion')
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
      store.characterStates.create(id, { publicState: 'a', innerState: 'b', activity: 'c', emotion })
    })

    it('changes only the fields given, bumping the version and the time', () => {
      const updated = store.characterStates.update(id, { activity: 'looking for the key' })
      expect(updated).toMatchObject({ publicState: 'a', innerState: 'b', activity: 'looking for the key', emotion, version: 2 })
      expect(updated.updatedAt > '2026-01-01T00:00:03.000Z').toBe(true)
      expect(store.characterStates.get(id)).toEqual(updated)
    })

    it('replaces or removes the emotion', () => {
      const calmer = { baseline: emotion.baseline, immediate: { valence: 0.1, arousal: 0, dominance: 0 } }
      expect(store.characterStates.update(id, { emotion: calmer }).emotion).toEqual(calmer)
      expect(store.characterStates.update(id, { emotion: null })).not.toHaveProperty('emotion')
      expect(store.characterStates.update(id, { emotion }).emotion).toEqual(emotion)
    })

    it('adds an emotion to a state that had none', () => {
      const other = store.characters.add(newCharacter({ sourceId: 'other', name: 'Other' })).id
      store.characterStates.create(other, { publicState: '', innerState: '', activity: '' })
      expect(store.characterStates.update(other, { emotion }).emotion).toEqual(emotion)
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

    it('rejects an emotion outside -1 to 1 and keeps the previous state', () => {
      const bad = { baseline: { valence: 2, arousal: 0, dominance: 0 }, immediate: emotion.immediate }
      expect(() => store.characterStates.update(id, { activity: 'changed', emotion: bad })).toThrow(InvalidValueError)
      expect(store.characterStates.get(id)).toMatchObject({ activity: 'c', version: 1 })
    })
  })
})
