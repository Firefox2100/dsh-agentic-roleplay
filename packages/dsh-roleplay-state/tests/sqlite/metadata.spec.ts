import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createSessionStore, type SessionStore } from '../../src/index.ts'
import { memoryStore, steppingClock } from '../helpers.ts'

let store: SessionStore

beforeEach(() => { store = memoryStore() })
afterEach(() => { store.close() })

describe('MetadataRepository', () => {
  it('holds the session identity and the world reference set at creation', () => {
    expect(store.metadata.get()).toEqual({
      id: 'session-1',
      title: 'First night',
      createdAt: '2026-01-01T00:00:01.000Z',
      world: { id: 'blackwater-observatory', name: 'The Blackwater Observatory' },
    })
  })

  it('keeps every field of a detailed world reference, including free-form extras', () => {
    const detailed = createSessionStore(':memory:', {
      id: 's',
      world: {
        id: 'blackwater-observatory',
        name: 'The Blackwater Observatory',
        version: '3',
        fingerprint: 'sha256:abc',
        source: 'worlds/blackwater-observatory',
        extra: { importedBy: { tool: 'x', flags: [1, true, null] } },
      },
    })
    expect(detailed.metadata.get().world).toEqual({
      id: 'blackwater-observatory',
      name: 'The Blackwater Observatory',
      version: '3',
      fingerprint: 'sha256:abc',
      source: 'worlds/blackwater-observatory',
      extra: { importedBy: { tool: 'x', flags: [1, true, null] } },
    })
    expect(detailed.metadata.get()).not.toHaveProperty('title')
    detailed.close()
  })

  it('changes the title and the world reference', () => {
    store.metadata.setTitle('Renamed')
    expect(store.metadata.get().title).toBe('Renamed')
    store.metadata.setTitle(null)
    expect(store.metadata.get()).not.toHaveProperty('title')
    store.metadata.setWorld({ id: 'blackwater-observatory', name: 'The Blackwater Observatory', version: '2' })
    expect(store.metadata.get().world.version).toBe('2')
  })

  it('stores free-form values for other code, with any JSON content', () => {
    expect(store.metadata.getValue('notes.lastExport')).toBeUndefined()
    store.metadata.setValue('notes.lastExport', { at: '2026-01-02', files: ['a', 'b'] })
    expect(store.metadata.getValue('notes.lastExport')).toEqual({ at: '2026-01-02', files: ['a', 'b'] })
    store.metadata.setValue('notes.lastExport', null)
    expect(store.metadata.getValue('notes.lastExport')).toBeNull()
    expect(store.metadata.deleteValue('notes.lastExport')).toBe(true)
    expect(store.metadata.deleteValue('notes.lastExport')).toBe(false)
    expect(store.metadata.getValue('notes.lastExport')).toBeUndefined()
  })

  it('keeps the session\'s own keys out of reach of free-form values', () => {
    for (const key of ['session.id', 'session.title', 'session.created_at', 'world']) {
      expect(() => store.metadata.setValue(key, 'x')).toThrow(/reserved/)
      expect(() => store.metadata.getValue(key)).toThrow(/reserved/)
      expect(() => store.metadata.deleteValue(key)).toThrow(/reserved/)
    }
    expect(store.metadata.get().id).toBe('session-1')
  })

  it('needs a session id', () => {
    expect(() => createSessionStore(':memory:', { id: ' ', world: { id: 'w', name: 'W' } }, { clock: steppingClock() })).toThrow(RangeError)
  })
})
