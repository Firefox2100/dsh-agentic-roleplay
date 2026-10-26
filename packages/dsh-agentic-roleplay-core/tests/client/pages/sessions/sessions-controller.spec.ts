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

const { SessionsController } = await import('../../../../src/client/pages/sessions/sessions-controller.ts')
const payload = { directory: '/sessions', sessions: [], problems: [] }
const settle = () => new Promise(resolve => setTimeout(resolve, 10))
let requests: string[]

beforeEach(() => {
  requests = []
  vi.stubGlobal('fetch', vi.fn((url: string, init?: RequestInit) => {
    requests.push(`${init?.method ?? 'GET'} ${url}`)
    if (url.endsWith('/sync/status')) return Promise.resolve(new Response(JSON.stringify({ running: false, units: [] })))
    if (url === 'roleplay-api/sessions') return Promise.resolve(new Response(JSON.stringify(payload)))
    return Promise.resolve(new Response(null, { status: 204 }))
  }))
})

afterEach(() => { vi.unstubAllGlobals() })

describe('deleting a synced session from the sessions page', () => {
  it('offers remote deletion when sync is configured and sends the choice to the host', async () => {
    const controller = new SessionsController(() => undefined)
    const face = controller.inject()
    face.askRemoval('night/one', 'Night one')
    await settle()
    expect(controller.store.getSnapshot().removal).toMatchObject({ id: 'night/one', sync: true, deleting: false })
    face.setEverywhere(true)
    face.confirmRemoval()
    await settle()
    expect(requests).toContain('DELETE roleplay-api/sessions/item?id=night%2Fone&everywhere=true')
    expect(controller.store.getSnapshot().removal).toBeUndefined()
    expect(controller.store.getSnapshot().payload).toEqual(payload)
  })

  it('does not offer a remote choice when sync is off or its status cannot be read', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response(JSON.stringify({ running: false, units: [], problem: 'sync is off' })))))
    const off = new SessionsController(() => undefined)
    off.inject().askRemoval('one', 'One')
    await settle()
    expect(off.store.getSnapshot().removal?.sync).toBeUndefined()

    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('offline'))))
    const unavailable = new SessionsController(() => undefined)
    unavailable.inject().askRemoval('two', 'Two')
    await settle()
    expect(unavailable.store.getSnapshot().removal?.sync).toBeUndefined()
  })

  it('does not apply a late sync result to a different deletion dialog', async () => {
    const answers: Array<(response: Response) => void> = []
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(resolve => { answers.push(resolve) })))
    const controller = new SessionsController(() => undefined)
    const face = controller.inject()
    face.askRemoval('one', 'One')
    face.askRemoval('two', 'Two')
    answers[0]?.(new Response(JSON.stringify({ running: false, units: [] })))
    await settle()
    expect(controller.store.getSnapshot().removal).toEqual({ id: 'two', name: 'Two', deleting: false })
  })

  it('keeps the dialog open with the host error when remote deletion fails', async () => {
    vi.stubGlobal('fetch', vi.fn((url: string, init?: RequestInit) => {
      if (url.endsWith('/sync/status')) return Promise.resolve(new Response(JSON.stringify({ running: false, units: [] })))
      if (init?.method === 'DELETE') return Promise.resolve(new Response(JSON.stringify({ message: 'remote unavailable' }), { status: 502 }))
      return Promise.resolve(new Response(JSON.stringify(payload)))
    }))
    const controller = new SessionsController(() => undefined)
    const face = controller.inject()
    face.askRemoval('one', 'One')
    await settle()
    face.setEverywhere(true)
    face.confirmRemoval()
    await settle()
    expect(controller.store.getSnapshot().removal).toMatchObject({ id: 'one', deleting: false, everywhere: true, error: 'remote unavailable' })
  })
})
