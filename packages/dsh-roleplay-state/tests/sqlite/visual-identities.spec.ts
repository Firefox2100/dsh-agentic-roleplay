import { describe, expect, it } from 'vitest'
import { ConflictError, NotFoundError } from '../../src/index.ts'
import { memoryStore, newCharacter } from '../helpers.ts'

describe('visual identities', () => {
  it('stores optional canonical identity for every entity kind and versions changes', () => {
    const session = memoryStore()
    const character = session.characters.add(newCharacter())
    const location = session.locations.add({ sourceId: 'square', name: 'Square', description: '', features: [] })
    const item = session.items.add({ sourceId: 'key', name: 'Key', description: '', quantity: 1, unique: true, quality: '', notable: false, hidden: false }, { kind: 'location', locationId: location.id })
    const canonical = { description: 'A sharply cut silhouette.', tags: ['dark coat'], negativeTags: ['modern clothing'] }

    expect(session.visualIdentities.get('character', character.id)).toBeUndefined()
    expect(session.visualIdentities.set('character', character.id, canonical)).toMatchObject({ ...canonical, version: 1 })
    expect(session.visualIdentities.set('location', location.id, { ...canonical, globalId: 'place-019' })).toMatchObject({ subjectKind: 'location', globalId: 'place-019' })
    expect(session.visualIdentities.set('item', item.id, canonical).subjectKind).toBe('item')
    expect(session.visualIdentities.update('character', character.id, { tags: ['dark coat', 'grey eyes'] })).toMatchObject({ version: 2, tags: ['dark coat', 'grey eyes'] })
    expect(session.visualIdentities.list()).toHaveLength(3)
  })

  it('requires a real subject and a unique global id', () => {
    const session = memoryStore()
    const first = session.characters.add(newCharacter())
    const second = session.characters.add(newCharacter({ sourceId: 'second', name: 'Second' }))
    const identity = { globalId: 'person-1', description: 'A person.', tags: [], negativeTags: [] }
    session.visualIdentities.set('character', first.id, identity)
    expect(() => session.visualIdentities.set('character', second.id, identity)).toThrow(ConflictError)
    expect(() => session.visualIdentities.set('item', 999, identity)).toThrow(NotFoundError)
  })
})
