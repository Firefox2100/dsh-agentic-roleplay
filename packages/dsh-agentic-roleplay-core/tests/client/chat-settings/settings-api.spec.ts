import { afterEach, describe, expect, it, vi } from 'vitest'
import { loadAuthoringSettings, saveAuthoringSettings } from '../../../src/client/chat-settings/settings-api.ts'
import { API_PREFIX } from '../../../src/shared/worlds.ts'

const answer = (status: number, body: unknown): Response => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

const signal = (): AbortSignal => new AbortController().signal

afterEach(() => { vi.unstubAllGlobals() })

describe('the settings of a world\'s authoring conversations', () => {
  it('reads them by world', async () => {
    const fetch = vi.fn(async () => answer(200, { toolHiding: 'phase', keepResultTurns: 0 }))
    vi.stubGlobal('fetch', fetch)
    const card = signal()

    await expect(loadAuthoringSettings('harbor', card)).resolves.toEqual({ toolHiding: 'phase', keepResultTurns: 0 })

    expect((fetch.mock.calls[0] as unknown[] | undefined)?.[0]).toBe(`${API_PREFIX}/worlds/authoring/settings?id=harbor`)
    expect((fetch.mock.calls[0] as unknown[] | undefined)?.[1]).toEqual({ credentials: 'same-origin', signal: card })
  })

  it('writes only the fields it was given, and answers with what the server kept', async () => {
    const fetch = vi.fn(async () => answer(200, { toolHiding: 'off', keepResultTurns: 2 }))
    vi.stubGlobal('fetch', fetch)
    const card = signal()

    await expect(saveAuthoringSettings('harbor', { toolHiding: 'off' }, card)).resolves.toEqual({ toolHiding: 'off', keepResultTurns: 2 })

    expect((fetch.mock.calls[0] as unknown[] | undefined)?.[0]).toBe(`${API_PREFIX}/worlds/authoring/settings?id=harbor`)
    expect((fetch.mock.calls[0] as unknown[] | undefined)?.[1]).toEqual({ method: 'PUT', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ toolHiding: 'off' }), signal: card })
  })

  it('says what the server said when they cannot be read or written', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => answer(404, { message: 'there is no such world' })))
    await expect(loadAuthoringSettings('nowhere', signal())).rejects.toThrow('there is no such world')

    vi.stubGlobal('fetch', vi.fn(async () => answer(422, { message: 'keepResultTurns must be a whole number from 0 to 20' })))
    await expect(saveAuthoringSettings('harbor', { keepResultTurns: 99 }, signal())).rejects.toThrow('keepResultTurns must be a whole number from 0 to 20')
  })

  it('falls back to the status when the refusal says nothing', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('not json', { status: 503, statusText: 'Service Unavailable' })))
    await expect(loadAuthoringSettings('harbor', signal())).rejects.toThrow('503 Service Unavailable')
    await expect(saveAuthoringSettings('harbor', {}, signal())).rejects.toThrow('503 Service Unavailable')
  })
})
