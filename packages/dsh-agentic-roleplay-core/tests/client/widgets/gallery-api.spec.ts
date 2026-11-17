import { afterEach, describe, expect, it, vi } from 'vitest'
import { describeImage } from '../../../src/client/widgets/gallery-view/gallery-api.ts'

const TARGET = { kind: 'worlds' as const, id: 'harbor' }
const SIGNAL = new AbortController().signal

afterEach(() => { vi.unstubAllGlobals() })

function responseOf(body: unknown, init: { ok: boolean; status?: number; statusText?: string }): Response {
  return { ok: init.ok, status: init.status ?? (init.ok ? 200 : 500), statusText: init.statusText ?? '', json: async () => body } as unknown as Response
}

describe('asking the host to describe a picture of a world', () => {
  it('posts to the describe route of that world and hands back the picture it now is', async () => {
    const image = { path: 'library/dock.png', description: 'The dock at night.', tags: ['dock'], subjects: [] }
    const fetchMock = vi.fn(async () => responseOf(image, { ok: true }))
    vi.stubGlobal('fetch', fetchMock)

    expect(await describeImage(TARGET, 'library/dock.png', SIGNAL)).toEqual(image)
    expect(fetchMock).toHaveBeenCalledWith(
      'roleplay-api/worlds/gallery/describe?id=harbor&path=library%2Fdock.png',
      expect.objectContaining({ method: 'POST', credentials: 'same-origin', signal: SIGNAL }),
    )
  })

  it('says why the host refused, in the host\'s own words when it gave any', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => responseOf({ message: 'choose a vision model in the chat settings' }, { ok: false, status: 409 })))
    await expect(describeImage(TARGET, 'library/dock.png', SIGNAL)).rejects.toThrow('choose a vision model in the chat settings')
  })

  it('falls back to the status when the refusal carries no message', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => responseOf(undefined, { ok: false, status: 503, statusText: 'Service Unavailable' })))
    await expect(describeImage(TARGET, 'library/dock.png', SIGNAL)).rejects.toThrow('503 Service Unavailable')
  })
})
