import { describe, expect, it, vi } from 'vitest'
import { createSlotList } from '../../../src/client/widgets/slot-list/slot-list.ts'

interface FakeEntry {
  options: { id: string; order?: number; label?: string | (() => string) }
}

/** The slot service a widget sees: the entries registered into one slot, and the listeners that want to know about a change. */
function fakeSlots(entries: FakeEntry[]) {
  const listeners = new Map<string, Set<() => void>>()
  const of = (slot: string): Set<() => void> => {
    const found = listeners.get(slot) ?? new Set<() => void>()
    listeners.set(slot, found)
    return found
  }
  return {
    slots: {
      entriesOfSlot: (slot: string) => (slot === 'roleplay.page' ? entries : []),
      subscribe: (slot: string, listener: () => void) => {
        of(slot).add(listener)
        return () => { of(slot).delete(listener) }
      },
    },
    listeners: (slot: string) => of(slot),
  }
}

function fakeContext(slots: unknown) {
  const localeListeners = new Set<() => void>()
  return {
    ctx: {
      slots,
      locale: {
        subscribe: (listener: () => void) => { localeListeners.add(listener); return () => { localeListeners.delete(listener) } },
      },
    },
    localeListeners,
  }
}

describe('the list of entries in a slot', () => {
  it('lists the entries in their order, with the label each gives', () => {
    const entries: FakeEntry[] = [
      { options: { id: 'second', order: 2, label: 'Second' } },
      { options: { id: 'first', order: 1, label: () => 'First' } },
      { options: { id: 'third', order: 1 } },
    ]
    const slots = fakeSlots(entries)
    const { ctx } = fakeContext(slots.slots)
    const { store, start } = createSlotList(ctx as never, 'roleplay.page')

    start()

    expect(store.getSnapshot()).toEqual([
      { id: 'first', label: 'First' },
      { id: 'third', label: 'third' },
      { id: 'second', label: 'Second' },
    ])
  })

  it('reads the label again when the language changes, and does not publish an unchanged list', () => {
    const entries: FakeEntry[] = [{ options: { id: 'only', label: () => 'Only' } }]
    const slots = fakeSlots(entries)
    const { ctx, localeListeners } = fakeContext(slots.slots)
    const { store, start } = createSlotList(ctx as never, 'roleplay.page')
    const seen = vi.fn()
    store.subscribe(seen)

    start()
    expect(seen).toHaveBeenCalledTimes(1)

    entries[0] = { options: { id: 'only', label: () => 'Seulement' } }
    for (const listener of localeListeners) listener()
    expect(store.getSnapshot()).toEqual([{ id: 'only', label: 'Seulement' }])
    expect(seen).toHaveBeenCalledTimes(2)

    for (const listener of localeListeners) listener()
    expect(seen, 'a list that reads the same is not published again').toHaveBeenCalledTimes(2)
  })

  it('listens to the registrations of its own slot and the language until it is stopped', () => {
    const slots = fakeSlots([{ options: { id: 'only', label: 'Only' } }])
    const { ctx, localeListeners } = fakeContext(slots.slots)
    const { start } = createSlotList(ctx as never, 'roleplay.reference.section')

    const stop = start()
    expect(slots.listeners('roleplay.reference.section').size).toBe(1)
    expect(slots.listeners('roleplay.page').size).toBe(0)
    expect(localeListeners.size).toBe(1)

    stop()
    expect(slots.listeners('roleplay.reference.section').size).toBe(0)
    expect(localeListeners.size).toBe(0)
  })
})
