import { afterEach, describe, expect, it, vi } from 'vitest'
import { BRANCHED_EVENT, branchAt } from '../../../src/client/transcript/branching.ts'

const chat = 'session-11111111-1111-4111-8111-111111111111'
const branch = 'session-22222222-2222-4222-8222-222222222222'

const scopeWith = (services: Record<string, unknown>) => ({ get: (name: string) => services[name] })

afterEach(() => { vi.unstubAllGlobals() })

describe('branching a story after a turn', () => {
  it('fails at the click when the client has no session service or no workspace', async () => {
    await expect(branchAt(scopeWith({}), chat, 3)).rejects.toThrow('branching is not available in this client')
    await expect(branchAt(scopeWith({ sessions: { fork: vi.fn() } }), chat, 3)).rejects.toThrow('branching is not available in this client')
    await expect(branchAt(scopeWith({ uiWorkspace: { openSession: vi.fn() } }), chat, 3)).rejects.toThrow('branching is not available in this client')
  })

  it('forks the chat, gives the branch its session, tells the window, and only then shows it', async () => {
    const fork = vi.fn(async () => branch)
    const page = new EventTarget()
    const heard: string[] = []
    page.addEventListener(BRANCHED_EVENT, event => { heard.push((event as CustomEvent<{ chat: string }>).detail.chat) })
    const order: string[] = []
    page.addEventListener(BRANCHED_EVENT, () => { order.push('told') })
    const openSession = vi.fn(() => { order.push('shown') })
    const calls: string[] = []
    vi.stubGlobal('window', page)
    vi.stubGlobal('fetch', vi.fn((url: string, init?: { method?: string; body?: string }) => {
      calls.push(`${init?.method ?? 'GET'} ${url} ${init?.body ?? ''}`.trim())
      return Promise.resolve(new Response(JSON.stringify({ id: 'branch-session' })))
    }))

    await branchAt(scopeWith({ sessions: { fork }, uiWorkspace: { openSession } }), chat, 3)

    expect(fork).toHaveBeenCalledWith({ sessionId: chat, atSeq: 3, increaseTitle: true })
    expect(calls).toEqual([`POST roleplay-api/sessions/branch ${JSON.stringify({ chat: branch, parent: chat, atSeq: 3 })}`])
    expect(heard).toEqual([branch])
    expect(openSession).toHaveBeenCalledWith(branch)
    expect(order).toEqual(['told', 'shown'])
  })

  it('says why in the host\'s words when the branch cannot be made, and shows nothing', async () => {
    const openSession = vi.fn()
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response(JSON.stringify({ message: 'the state was not kept' }), { status: 409 }))))
    await expect(branchAt(scopeWith({ sessions: { fork: async () => branch }, uiWorkspace: { openSession } }), chat, 3)).rejects.toThrow('the state was not kept')
    expect(openSession).not.toHaveBeenCalled()
  })

  it('falls back to the status when the refusal has no words of its own', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response('<html>not json</html>', { status: 500 }))))
    await expect(branchAt(scopeWith({ sessions: { fork: async () => branch }, uiWorkspace: { openSession: vi.fn() } }), chat, 3)).rejects.toThrow('the branch could not be made (500)')
  })

  it('still shows the branch where there is no window to tell', async () => {
    const openSession = vi.fn()
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response('{}'))))
    await branchAt(scopeWith({ sessions: { fork: async () => branch }, uiWorkspace: { openSession } }), chat, 0)
    expect(openSession).toHaveBeenCalledWith(branch)
  })
})
