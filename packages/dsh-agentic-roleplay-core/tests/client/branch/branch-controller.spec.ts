import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { BranchController as Controller } from '../../../src/client/branch/branch-controller.ts'

// The shell provides the store at run time; a small one stands in for it here.
vi.mock('@deepseek-ai/dsh-client-store', () => ({
  createSnapshotStore: <T extends object>(initial: T) => {
    let state = initial
    const listeners = new Set<() => void>()
    return {
      getSnapshot: () => state,
      subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener) } },
      update: (change: (draft: T) => void) => { const draft = structuredClone(state); change(draft); state = draft; for (const listener of listeners) listener() },
    }
  },
}))
const { BranchController } = await import('../../../src/client/branch/branch-controller.ts')
const { createSnapshotStore } = await import('@deepseek-ai/dsh-client-store')

type Row = { parentId?: string; origin?: 'subagent' }
const uuid = (digit: string) => `${digit.repeat(8)}-${digit.repeat(4)}-4${digit.repeat(3)}-8${digit.repeat(3)}-${digit.repeat(12)}`
const chat = (digit: string) => `session-${uuid(digit)}`

let list: ReturnType<typeof createSnapshotStore<{ phase: string; byId: Record<string, Row> }>>
let requests: string[]
let controller: Controller
let stop: () => void

const settle = () => new Promise(resolve => setTimeout(resolve, 10))
const appear = (id: string, row: Row) => { list.update((draft) => { draft.byId[id] = row }) }

beforeEach(() => {
  list = createSnapshotStore({ phase: 'pending', byId: {} })
  requests = []
  vi.stubGlobal('fetch', vi.fn((url: string, init?: { method?: string; body?: string }) => {
    requests.push(`${init?.method ?? 'GET'} ${url} ${init?.body ?? ''}`.trim())
    if (url.endsWith('/sessions')) {
      return Promise.resolve(new Response(JSON.stringify({ sessions: [{ id: uuid('b'), chatSessionId: chat('b'), name: 'Night 2' }], problems: [], directory: '' })))
    }
    return Promise.resolve(new Response(null, { status: 204 }))
  }))
  controller = new BranchController()
  stop = controller.watch(list)
})
afterEach(() => { stop(); vi.unstubAllGlobals() })

describe('asking for the name of a branch', () => {
  it('asks when a chat made from a roleplay chat appears after the list was loaded, offering the name the host gave it', async () => {
    list.update((draft) => { draft.phase = 'ready'; draft.byId[chat('a')] = {} })
    appear(chat('b'), { parentId: chat('a') })
    await settle()
    expect(controller.store.getSnapshot().pending).toEqual({ id: uuid('b'), name: 'Night 2' })
  })

  it('does not ask about chats that were there when the list loaded, sub-agents, chats made from nothing, or from a chat that is not a roleplay one', async () => {
    list.update((draft) => { draft.phase = 'ready'; draft.byId[chat('a')] = {}; draft.byId[chat('c')] = { parentId: chat('a') } })
    appear(chat('d'), { parentId: chat('a'), origin: 'subagent' })
    appear(chat('e'), {})
    appear(chat('f'), { parentId: 'session-not-a-uuid' })
    await settle()
    expect(controller.store.getSnapshot().pending).toBeUndefined()
    expect(requests).toEqual([])
  })

  it('does not ask while the list is still loading, whatever is in it', async () => {
    appear(chat('b'), { parentId: chat('a') })
    await settle()
    expect(requests).toEqual([])
  })

  it('renames the session with the name given and stops asking; leaving it as it is asks nothing of the host', async () => {
    list.update((draft) => { draft.phase = 'ready' })
    appear(chat('b'), { parentId: chat('a') })
    await settle()
    controller.inject().save('The cellar')
    await settle()
    expect(requests.at(-1)).toBe(`POST roleplay-api/sessions/rename?id=${uuid('b')} {"name":"The cellar"}`)
    expect(controller.store.getSnapshot()).toEqual({ saving: false })
    appear(chat('g'), { parentId: chat('a') })
    await settle()
    controller.inject().keep()
    expect(controller.store.getSnapshot().pending).toBeUndefined()
    expect(requests.filter(request => request.includes('/rename'))).toHaveLength(1)
  })

  it('keeps asking, with the reason, when the host refuses the name', async () => {
    list.update((draft) => { draft.phase = 'ready' })
    appear(chat('b'), { parentId: chat('a') })
    await settle()
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response(JSON.stringify({ message: 'the session needs a name' }), { status: 422 }))))
    controller.inject().save(' ')
    await settle()
    expect(controller.store.getSnapshot()).toMatchObject({ saving: false, error: 'the session needs a name', pending: { id: uuid('b') } })
  })
})
