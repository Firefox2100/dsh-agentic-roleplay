import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@deepseek-ai/dsh-client-store', () => ({
  createSnapshotStore: <T extends object>(initial: T) => {
    let state = initial
    return {
      getSnapshot: () => state,
      subscribe: () => () => undefined,
      update: (change: (draft: T) => void) => { const draft = structuredClone(state); change(draft); state = draft },
    }
  },
}))

const { SyncController } = await import('../../../../src/client/pages/sync/sync-controller.ts')
const settle = () => new Promise(resolve => setTimeout(resolve, 10))
let requests: string[]

beforeEach(() => {
  requests = []
  vi.stubGlobal('fetch', vi.fn((url: string, init?: RequestInit) => {
    requests.push(`${init?.method ?? 'GET'} ${url} ${init?.body ?? ''}`.trim())
    return Promise.resolve(new Response(JSON.stringify(url.endsWith('/status') ? { running: false, units: [] } : null)))
  }))
})

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers() })

describe('the sync page controller', () => {
  it('loads once, refreshes, and runs every supported operation', async () => {
    const controller = new SyncController()
    const face = controller.inject()
    face.load()
    face.load()
    await settle()
    expect(controller.store.getSnapshot()).toMatchObject({ status: 'ready', working: false, sync: { running: false } })
    face.refresh()
    face.run('worlds/harbor')
    await settle()
    face.resolve('worlds/harbor', 'local')
    await settle()
    face.forget('worlds/harbor')
    await settle()
    face.restore('worlds/harbor')
    await settle()
    expect(requests.some(request => request.includes('/sync/run'))).toBe(true)
    expect(requests.some(request => request.includes('/sync/resolve'))).toBe(true)
    expect(requests.some(request => request.includes('/sync/forget'))).toBe(true)
    expect(requests.some(request => request.includes('/sync/restore'))).toBe(true)
    controller.dispose()
  })

  it('reports failures and ignores results after disposal', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response(JSON.stringify({ message: 'remote unavailable' }), { status: 502 }))))
    const controller = new SyncController()
    controller.inject().load()
    await settle()
    expect(controller.store.getSnapshot()).toMatchObject({ status: 'failed', error: 'remote unavailable' })
    controller.inject().run()
    controller.dispose()
    await settle()
    expect(controller.store.getSnapshot().working).toBe(true)
  })
})
