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
      name: 'First night',
      createdAt: '2026-01-01T00:00:01.000Z',
      turns: 0,
      world: { id: 'blackwater-observatory', name: 'The Blackwater Observatory' },
    })
  })

  it('keeps every field of a detailed world reference, including free-form extras', () => {
    const detailed = createSessionStore(':memory:', {
      id: 's',
      name: 'S',
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
    detailed.close()
  })

  it('changes the name and the world reference', () => {
    store.metadata.setName('  Renamed  ')
    expect(store.metadata.get().name).toBe('Renamed')
    expect(() => store.metadata.setName('  ')).toThrow(RangeError)
    expect(store.metadata.get().name).toBe('Renamed')
    store.metadata.setWorld({ id: 'blackwater-observatory', name: 'The Blackwater Observatory', version: '2' })
    expect(store.metadata.get().world.version).toBe('2')
  })

  describe('turns', () => {
    it('start at none, with no time of last play', () => {
      expect(store.metadata.get().turns).toBe(0)
      expect(store.metadata.get()).not.toHaveProperty('lastPlayedAt')
    })

    it('are counted one at a time, each setting the time of last play', () => {
      const first = store.metadata.recordTurn()
      expect(first).toMatchObject({ turns: 1, lastPlayedAt: '2026-01-01T00:00:02.000Z' })
      const second = store.metadata.recordTurn()
      expect(second).toMatchObject({ turns: 2 })
      expect(second.lastPlayedAt! > first.lastPlayedAt!).toBe(true)
      expect(store.metadata.get()).toEqual(second)
    })

    it('do not change what else the metadata says', () => {
      const before = store.metadata.get()
      const after = store.metadata.recordTurn()
      expect({ ...after, turns: 0, lastPlayedAt: undefined }).toEqual({ ...before, lastPlayedAt: undefined })
    })
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
    for (const key of ['session.id', 'session.name', 'session.created_at', 'session.last_played_at', 'session.turns', 'world']) {
      expect(() => store.metadata.setValue(key, 'x')).toThrow(/reserved/)
      expect(() => store.metadata.getValue(key)).toThrow(/reserved/)
      expect(() => store.metadata.deleteValue(key)).toThrow(/reserved/)
    }
    expect(store.metadata.get().id).toBe('session-1')
  })

  it('needs a session id and a name', () => {
    expect(() => createSessionStore(':memory:', { id: ' ', name: 'N', world: { id: 'w', name: 'W' } }, { clock: steppingClock() })).toThrow(RangeError)
    expect(() => createSessionStore(':memory:', { id: 's', name: ' ', world: { id: 'w', name: 'W' } }, { clock: steppingClock() })).toThrow(RangeError)
  })
})
