import { afterEach, describe, expect, it, vi } from 'vitest'
import { compareCheckpoint, loadCast, loadCheckpoints, makeCheckpoint, restoreCheckpoint } from '../../../src/client/world-editor/world-files-api.ts'

const checkpoint = { id: 'c1', at: '2026-01-01T00:00:00.000Z', label: 'before an edit' }
const signal = () => new AbortController().signal

afterEach(() => { vi.unstubAllGlobals() })

function answer(body: unknown): { calls: { url: string; init: RequestInit }[] } {
  const calls: { url: string; init: RequestInit }[] = []
  vi.stubGlobal('fetch', (url: string, init: RequestInit) => {
    calls.push({ url, init })
    return Promise.resolve({ ok: true, status: 200, statusText: 'OK', json: () => Promise.resolve(body) })
  })
  return { calls }
}

describe('the checkpoint calls of the world editor', () => {
  it('lists the checkpoints of a world, newest first', async () => {
    const { calls } = answer({ checkpoints: [checkpoint] })
    expect(await loadCheckpoints('harbor', signal())).toEqual([checkpoint])
    expect(calls[0]!.url).toBe('roleplay-api/worlds/checkpoints?id=harbor')
    expect(calls[0]!.init.method).toBe('GET')
    expect(calls[0]!.init.credentials).toBe('same-origin')
  })

  it('makes a checkpoint with the label the person typed', async () => {
    const { calls } = answer(checkpoint)
    expect(await makeCheckpoint('harbor', 'before the rewrite', signal())).toEqual(checkpoint)
    expect(calls[0]!.url).toBe('roleplay-api/worlds/checkpoints?id=harbor')
    expect(calls[0]!.init.method).toBe('POST')
    expect(calls[0]!.init.body).toBe(JSON.stringify({ label: 'before the rewrite' }))
    expect(calls[0]!.init.headers).toEqual({ 'content-type': 'application/json' })
  })

  it('compares a world with a checkpoint and puts one back', async () => {
    const diff = { changed: ['world.json'], added: [], removed: [] }
    const first = answer(diff)
    expect(await compareCheckpoint('harbor', 'c1', signal())).toEqual(diff)
    expect(first.calls[0]!.url).toBe('roleplay-api/worlds/checkpoints/diff?id=harbor&checkpoint=c1')
    expect(first.calls[0]!.init.method).toBe('GET')

    const second = answer(undefined)
    await restoreCheckpoint('harbor', 'c1', signal())
    expect(second.calls[0]!.url).toBe('roleplay-api/worlds/checkpoints/restore?id=harbor')
    expect(second.calls[0]!.init.method).toBe('POST')
    expect(second.calls[0]!.init.body).toBe(JSON.stringify({ checkpoint: 'c1' }))
  })

  it('says what the server refused when a restore is not allowed', async () => {
    vi.stubGlobal('fetch', () => Promise.resolve({
      ok: false, status: 422, statusText: 'Unprocessable Content',
      json: () => Promise.resolve({ message: 'a chat is being written right now' }),
    }))
    await expect(restoreCheckpoint('harbor', 'c1', signal())).rejects.toThrow('a chat is being written right now')
  })
})

describe('the cast of a world', () => {
  it('reads who can be played and who is there to speak', async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify({ characters: [{ id: 'tam', name: 'Tam', role: 'playable' }, { id: 'mara', name: 'Mara', role: 'narrator' }] }), { status: 200 }))
    vi.stubGlobal('fetch', fetch)
    const cast = await loadCast('harbor', new AbortController().signal)
    expect(cast).toEqual([{ id: 'tam', name: 'Tam', playable: true }, { id: 'mara', name: 'Mara', playable: false }])
    expect(String((fetch.mock.calls[0] as unknown[] | undefined)?.[0])).toContain('roleplay-api/worlds/characters?id=harbor')
  })

  it('says what the server said when the cast cannot be read', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 503, statusText: 'Service Unavailable' })))
    await expect(loadCast('harbor', new AbortController().signal)).rejects.toThrow('503 Service Unavailable')
  })
})