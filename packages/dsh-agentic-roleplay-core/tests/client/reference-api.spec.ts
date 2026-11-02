import { afterEach, describe, expect, it, vi } from 'vitest'
import { loadCharacters, previewRecall } from '../../src/client/recall/recall-api.ts'
import { loadJournal, loadReference, saveJournal } from '../../src/client/reference/reference-api.ts'

const signal = new AbortController().signal

afterEach(() => { vi.unstubAllGlobals() })

describe('the recall client', () => {
  it('previews a situation and optionally narrows it to one character', async () => {
    const fetch = vi.fn(() => Promise.resolve(new Response(JSON.stringify({ situation: 'A bell rings.', characters: [] }))))
    vi.stubGlobal('fetch', fetch)
    await expect(previewRecall('story one', 'A bell rings.', 'clara', signal)).resolves.toMatchObject({ situation: 'A bell rings.' })
    expect(fetch).toHaveBeenCalledWith(expect.stringContaining('/sessions/recall?id=story%20one'), expect.objectContaining({ method: 'POST', body: JSON.stringify({ situation: 'A bell rings.', character: 'clara' }) }))
    await previewRecall('story one', 'Silence.', undefined, signal)
    const calls = fetch.mock.calls as unknown as [string, RequestInit][]
    expect(JSON.parse(calls[1]![1].body as string)).toEqual({ situation: 'Silence.' })
  })

  it('lists only agent characters and reports JSON or plain failures', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response(JSON.stringify({ characters: [{ key: 'p', name: 'Player', control: 'player' }, { key: 'c', name: 'Clara', control: 'agent' }] })))))
    await expect(loadCharacters('story', signal)).resolves.toEqual([{ key: 'c', name: 'Clara' }])
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response(JSON.stringify({ message: 'story is gone' }), { status: 404 }))))
    await expect(loadCharacters('gone', signal)).rejects.toThrow('story is gone')
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response('down', { status: 502, statusText: 'Bad Gateway' }))))
    await expect(previewRecall('story', 'Now', undefined, signal)).rejects.toThrow('502 Bad Gateway')
  })
})

describe('the reference client', () => {
  it('loads a page with an optional character and reports both kinds of failure', async () => {
    const fetch = vi.fn(() => Promise.resolve(new Response(JSON.stringify({ entries: [{ key: 'clara' }] }))))
    vi.stubGlobal('fetch', fetch)
    await expect(loadReference('story one', 'profile', signal, 'clara smith')).resolves.toEqual({ entries: [{ key: 'clara' }] })
    const calls = fetch.mock.calls as unknown as [string, RequestInit][]
    expect(calls[0]![0]).toContain('/sessions/reference?id=story%20one&section=profile&character=clara%20smith')
    await loadReference('story', 'places', signal)
    expect(calls[1]![0]).not.toContain('&character=')
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response(JSON.stringify({ message: 'unknown page' }), { status: 400 }))))
    await expect(loadReference('story', 'places', signal)).rejects.toThrow('unknown page')
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response('', { status: 503, statusText: 'Unavailable' }))))
    await expect(loadReference('story', 'places', signal)).rejects.toThrow('503 Unavailable')
  })

  it('loads and saves the journal, with or without an abort signal', async () => {
    const fetch = vi.fn(() => Promise.resolve(new Response(JSON.stringify({ text: 'Remember this.' }))))
    vi.stubGlobal('fetch', fetch)
    await expect(loadJournal('story', signal)).resolves.toEqual({ text: 'Remember this.' })
    await expect(saveJournal('story', 'Remember this.', signal)).resolves.toEqual({ text: 'Remember this.' })
    const calls = fetch.mock.calls as unknown as [string, RequestInit][]
    expect(calls[1]![1]).toMatchObject({ method: 'PUT', signal, body: JSON.stringify({ text: 'Remember this.' }) })
    await saveJournal('story', 'Later.')
    expect(calls[2]![1]).not.toHaveProperty('signal')
  })

  it('reports journal errors from JSON and from the response status', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response(JSON.stringify({ message: 'too long' }), { status: 422 }))))
    await expect(saveJournal('story', 'x')).rejects.toThrow('too long')
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response('down', { status: 500, statusText: 'Broken' }))))
    await expect(loadJournal('story', signal)).rejects.toThrow('500 Broken')
  })
})
