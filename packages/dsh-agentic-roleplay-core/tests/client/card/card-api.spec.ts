import { afterEach, describe, expect, it, vi } from 'vitest'
import { loadCard, loadPiece } from '../../../src/client/card/card-api.ts'
import { API_PREFIX } from '../../../src/shared/worlds.ts'

const answer = (status: number, body: unknown): Response => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

const signal = (): AbortSignal => new AbortController().signal

afterEach(() => { vi.unstubAllGlobals() })

describe('reading a world\'s source card', () => {
  it('asks for the card by world, and for one piece of it by name', async () => {
    const view = { present: true, pieces: [] }
    const piece = { id: 'entry:3', label: 'entry', text: 'Grey and old.' }
    const fetch = vi.fn(async (input: string) => answer(200, input.includes('/piece') ? piece : view))
    vi.stubGlobal('fetch', fetch)
    const card = signal()
    const one = signal()

    await expect(loadCard('harbor', card)).resolves.toEqual(view)
    await expect(loadPiece('harbor', 'entry:3', one)).resolves.toEqual(piece)

    expect(fetch.mock.calls.map(call => (call as unknown[])[0])).toEqual([
      `${API_PREFIX}/worlds/card?id=harbor`,
      `${API_PREFIX}/worlds/card/piece?id=harbor&piece=entry%3A3`,
    ])
    expect((fetch.mock.calls[0] as unknown[])[1]).toEqual({ credentials: 'same-origin', signal: card })
  })

  it('says what the server said when the card cannot be read', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => answer(404, { message: 'there is no such world' })))
    await expect(loadCard('nowhere', signal())).rejects.toThrow('there is no such world')
  })

  it('falls back to the status when the refusal says nothing', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('not json', { status: 503, statusText: 'Service Unavailable' })))
    await expect(loadPiece('harbor', 'entry:3', signal())).rejects.toThrow('503 Service Unavailable')
  })
})
