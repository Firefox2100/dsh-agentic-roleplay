import { describe, expect, it } from 'vitest'
import { memoryStore, newCharacter } from '../helpers.ts'

describe('lore repository', () => {
  it('stores subjects, relations and explicit character knowledge separately', () => {
    const store = memoryStore(); const character = store.characters.add(newCharacter())
    const founding = store.lore.add({ sourceId: 'founding', title: 'The founding', kind: 'history', summary: 'A river town was founded.', body: 'The longer canonical account.', subjects: [{ kind: 'character', id: character.id }], related: [], sources: ['parish register'] })
    const custom = store.lore.add({ sourceId: 'bell-custom', title: 'The bell custom', kind: 'custom', summary: '', body: 'The bell rings at dusk.', subjects: [], related: [founding.id], sources: [] })
    expect(store.lore.getBySourceId('bell-custom')).toMatchObject({ id: custom.id, related: [founding.id] })
    expect(store.knowledge.list(character.id, 'lore')).toEqual([])
    store.knowledge.learn(character.id, 'lore', founding.id, 0)
    expect(store.knowledge.knows(character.id, 'lore', founding.id)).toBe(true)
  })

  it('keeps an entry listed unless it is made common knowledge, and can change it', () => {
    const store = memoryStore()
    const entry = store.lore.add({ title: 'The tides', kind: 'geography', summary: '', body: 'Twice a day.', subjects: [], related: [], sources: [] })
    expect(entry.scope).toBe('listed')
    expect(store.lore.add({ title: 'The law', kind: 'politics', scope: 'everyone', summary: '', body: 'Stated.', subjects: [], related: [], sources: [] }).scope).toBe('everyone')
    expect(store.lore.update(entry.id, { scope: 'everyone' }).scope).toBe('everyone')
  })
})
