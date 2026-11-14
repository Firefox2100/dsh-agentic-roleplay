import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

interface FakeStorage {
  value: string | null
  refuse?: boolean
  writes: string[]
}

function install(storage: FakeStorage): void {
  ;(globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (): string | null => {
      if (storage.refuse === true) throw new Error('storage is blocked')
      return storage.value
    },
    setItem: (_key: string, next: string): void => {
      if (storage.refuse === true) throw new Error('storage is blocked')
      storage.value = next
      storage.writes.push(next)
    },
  }
}

const storageOf = (value: string | null, refuse = false): FakeStorage => ({ value, refuse, writes: [] })

/** The module reads the stored choice once, when it loads: every case loads it again against its own storage. */
async function load(): Promise<typeof import('../../../src/client/transcript/dock-fold.ts')> {
  vi.resetModules()
  return await import('../../../src/client/transcript/dock-fold.ts')
}

beforeEach(() => { vi.resetModules() })

afterEach(() => {
  delete (globalThis as { localStorage?: unknown }).localStorage
})

describe('the folded state of the story tools', () => {
  it('is unfolded where there is no page to remember it in', async () => {
    const { readFolded, toggleFolded } = await load()
    expect(readFolded()).toBe(false)
    expect(() => { toggleFolded() }).not.toThrow()
  })

  it('reads the choice this browser kept', async () => {
    install(storageOf('1'))
    expect((await load()).readFolded()).toBe(true)
    install(storageOf('0'))
    expect((await load()).readFolded()).toBe(false)
    install(storageOf(null))
    expect((await load()).readFolded()).toBe(false)
  })

  it('falls back to unfolded when the storage refuses to be read', async () => {
    install(storageOf('1', true))
    expect((await load()).readFolded()).toBe(false)
  })

  it('writes each flip and tells the docks', async () => {
    const storage = storageOf(null)
    install(storage)
    const { toggleFolded, subscribeFolded } = await load()
    const heard: number[] = []
    const stop = subscribeFolded(() => { heard.push(heard.length + 1) })

    toggleFolded()
    toggleFolded()

    expect(storage.writes).toEqual(['1', '0'])
    expect(heard).toHaveLength(2)

    stop()
    toggleFolded()
    expect(heard, 'a listener that left is not told again').toHaveLength(2)
  })

  it('keeps the flip for the page when the storage refuses to be written', async () => {
    const storage = storageOf(null, true)
    install(storage)
    const { toggleFolded, subscribeFolded } = await load()
    let heard = 0
    subscribeFolded(() => { heard += 1 })

    expect(() => { toggleFolded() }).not.toThrow()
    expect(storage.writes).toEqual([])
    expect(heard).toBe(1)
  })
})
