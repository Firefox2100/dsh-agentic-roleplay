import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ConflictError, InvalidValueError, NotFoundError, type SessionStore } from '../../src/index.ts'
import { memoryStore, newCharacter } from '../helpers.ts'

let store: SessionStore

beforeEach(() => { store = memoryStore() })
afterEach(() => { store.close() })

describe('CharacterRepository', () => {
  it('stores a character and reads it back as the canonical model', () => {
    const added = store.characters.add(newCharacter())
    expect(added).toEqual({
      id: 1,
      sourceId: 'eleanor-graves',
      name: 'Eleanor Graves',
      aliases: ['Ellie', 'the Mayor'],
      age: '42',
      gender: 'female',
      pronouns: 'she/her',
      kind: 'person',
      tier: 'principal',
      role: 'npc',
      control: 'agent',
      summary: 'Mayor of Blackwater Ridge.',
      personality: 'Calculating and practical.',
      background: 'Born in the town.',
      appearance: 'Sharp features.',
      speech: { style: 'Formal, clipped.', examples: ['Let us not make a scene.'] },
      createdAt: '2026-01-01T00:00:02.000Z',
    })
    expect(store.characters.get(added.id)).toEqual(added)
  })

  it('leaves out what is not set and gives each character its own id', () => {
    const bare = store.characters.add(newCharacter({
      sourceId: undefined, age: undefined, gender: undefined, pronouns: undefined, aliases: [],
    }))
    expect(bare).not.toHaveProperty('sourceId')
    expect(bare).not.toHaveProperty('age')
    expect(bare.aliases).toEqual([])
    expect(store.characters.add(newCharacter({ sourceId: 'second', name: 'Second' })).id).toBe(bare.id + 1)
  })

  it('finds characters by their world id', () => {
    const added = store.characters.add(newCharacter())
    expect(store.characters.getBySourceId('eleanor-graves')).toEqual(added)
    expect(store.characters.getBySourceId('unknown')).toBeUndefined()
    expect(store.characters.get(99)).toBeUndefined()
  })

  it('refuses a second character with the same world id', () => {
    store.characters.add(newCharacter())
    expect(() => store.characters.add(newCharacter({ name: 'Another' }))).toThrow(ConflictError)
    expect(store.characters.list()).toHaveLength(1)
  })

  it('allows several characters created during play, which have no world id', () => {
    store.characters.add(newCharacter({ sourceId: undefined, name: 'A' }))
    store.characters.add(newCharacter({ sourceId: undefined, name: 'B' }))
    expect(store.characters.list()).toHaveLength(2)
  })

  it('keeps alias order and drops aliases repeated with different case', () => {
    const added = store.characters.add(newCharacter({ aliases: ['Zed', 'Ann', 'zed'] }))
    expect(added.aliases).toEqual(['Zed', 'Ann'])
  })

  it('lists in creation order and filters', () => {
    store.characters.add(newCharacter({ sourceId: 'a', name: 'A', role: 'playable', control: 'player' }))
    store.characters.add(newCharacter({ sourceId: 'b', name: 'B', tier: 'background', kind: 'group' }))
    store.characters.add(newCharacter({ sourceId: 'c', name: 'C' }))
    const names = (characters: { name: string }[]): string[] => characters.map(character => character.name)
    expect(names(store.characters.list())).toEqual(['A', 'B', 'C'])
    expect(names(store.characters.list({ role: 'playable' }))).toEqual(['A'])
    expect(names(store.characters.list({ control: 'agent' }))).toEqual(['B', 'C'])
    expect(names(store.characters.list({ kind: 'group', tier: 'background' }))).toEqual(['B'])
    expect(store.characters.list({ role: 'playable', tier: 'background' })).toEqual([])
  })

  describe('findByName', () => {
    beforeEach(() => {
      store.characters.add(newCharacter())
      store.characters.add(newCharacter({ sourceId: 'clara', name: 'Clara Whitlock', aliases: ['Clara'] }))
      store.characters.add(newCharacter({ sourceId: 'cafe', name: 'Café Owner', aliases: ['Ｅllie'] }))
    })

    it('matches a name or an alias, ignoring case', () => {
      expect(store.characters.findByName('eleanor graves').map(c => c.name)).toEqual(['Eleanor Graves'])
      expect(store.characters.findByName('THE MAYOR').map(c => c.name)).toEqual(['Eleanor Graves'])
      expect(store.characters.findByName('  clara ').map(c => c.name)).toEqual(['Clara Whitlock'])
    })

    it('folds accents and width variants the way users type them', () => {
      expect(store.characters.findByName('CAFÉ OWNER').map(c => c.name)).toEqual(['Café Owner'])
      expect(store.characters.findByName('ellie').map(c => c.name)).toEqual(['Eleanor Graves', 'Café Owner'])
    })

    it('finds nothing for a partial or unknown name', () => {
      expect(store.characters.findByName('Eleanor')).toEqual([])
      expect(store.characters.findByName('nobody')).toEqual([])
    })
  })

  it('changes who controls a character', () => {
    const { id } = store.characters.add(newCharacter({ role: 'playable', control: 'agent' }))
    expect(store.characters.setControl(id, 'player').control).toBe('player')
    expect(store.characters.get(id)?.control).toBe('player')
    expect(() => store.characters.setControl(99, 'player')).toThrow(NotFoundError)
  })

  it('rejects values outside the schema, leaving nothing behind', () => {
    expect(() => store.characters.add(newCharacter({ kind: 'robot' as 'person', aliases: ['x'] }))).toThrow(InvalidValueError)
    expect(store.characters.list()).toEqual([])
    expect(store.characters.findByName('x')).toEqual([])
  })
})
