import { describe, expect, it, vi } from 'vitest'
import { createSnapshotStore, defineStore } from '../../src/client/store.ts'

describe('createSnapshotStore', () => {
  it('publishes a fresh snapshot and notifies every subscriber', () => {
    const store = createSnapshotStore<{ status: 'idle' | 'ready' | 'failed'; rows: string[] }>({ status: 'idle', rows: [] })
    const seen: string[] = []
    const stop = store.subscribe(() => seen.push(store.getSnapshot().status))
    store.update((draft) => { draft.status = 'ready' })
    store.update((draft) => { draft.rows.push('a') })
    expect(store.getSnapshot()).toEqual({ status: 'ready', rows: ['a'] })
    expect(seen).toEqual(['ready', 'ready'])
    stop()
    store.set({ status: 'failed', rows: [] })
    expect(seen).toEqual(['ready', 'ready'])
  })

  it('never mutates a published snapshot in place', () => {
    const store = createSnapshotStore({ rows: ['a'] })
    const before = store.getSnapshot()
    store.update((draft) => { draft.rows.push('b') })
    expect(before.rows).toEqual(['a'])
    expect(store.getSnapshot()).not.toBe(before)
  })

  it('keeps dispatching when a subscriber unsubscribes itself', () => {
    const store = createSnapshotStore({ count: 0 })
    const late = vi.fn()
    const stop = store.subscribe(() => { stop(); late() })
    store.update((draft) => { draft.count = 1 })
    expect(late).toHaveBeenCalledTimes(1)
  })
})

describe('defineStore', () => {
  const handle = defineStore({
    init: () => ({ page: undefined as string | undefined }),
    actions: { selectPage: (draft, id: string) => { draft.page = id } },
  })

  it('bakes the draft out of each action', () => {
    const instance = handle.create()
    expect(instance.getSnapshot()).toEqual({ page: undefined })
    instance.actions.selectPage('worlds')
    expect(instance.getSnapshot()).toEqual({ page: 'worlds' })
  })

  it('starts every instance from its own initial state', () => {
    const first = handle.create()
    const second = handle.create()
    first.actions.selectPage('avatars')
    expect(second.getSnapshot().page).toBeUndefined()
  })

  it('exposes the declaration and drops nothing on clearPersisted', () => {
    const instance = handle.create()
    instance.actions.selectPage('sync')
    expect(handle.spec.actions.selectPage).toBeTypeOf('function')
    instance.clearPersisted()
    expect(instance.getSnapshot().page).toBe('sync')
  })
})
