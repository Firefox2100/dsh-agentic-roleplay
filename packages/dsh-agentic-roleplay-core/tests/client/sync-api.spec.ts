import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { describePassword, forgetSync, loadSyncStatus, resolveSync, restoreSync, runSync, storePassword } from '../../src/client/sync-api.ts'

const signal = new AbortController().signal
let requests: Array<{ url: string; init: RequestInit | undefined }>

beforeEach(() => {
  requests = []
  vi.stubGlobal('fetch', vi.fn((url: string, init?: RequestInit) => {
    requests.push({ url, init })
    return Promise.resolve(new Response(JSON.stringify(url.endsWith('/status') ? { running: false, units: [] } : null)))
  }))
})

afterEach(() => { vi.unstubAllGlobals() })

describe('the sync HTTP client', () => {
  it('sends reads, runs, choices, and local deletion choices to their endpoints', async () => {
    await loadSyncStatus(signal)
    await runSync(undefined, signal)
    await runSync(['worlds/harbor'], signal)
    await resolveSync('worlds/harbor', 'remote', signal)
    await forgetSync('worlds/harbor', signal)
    await restoreSync('worlds/harbor', signal)
    expect(requests.map(request => [request.url, request.init?.method, request.init?.body])).toEqual([
      ['roleplay-api/sync/status', undefined, undefined],
      ['roleplay-api/sync/run', 'POST', '{}'],
      ['roleplay-api/sync/run', 'POST', '{"units":["worlds/harbor"]}'],
      ['roleplay-api/sync/resolve', 'POST', '{"unit":"worlds/harbor","side":"remote"}'],
      ['roleplay-api/sync/forget', 'POST', '{"unit":"worlds/harbor"}'],
      ['roleplay-api/sync/restore', 'POST', '{"unit":"worlds/harbor"}'],
    ])
  })

  it('describes and changes the password without exposing its value', async () => {
    const events: string[] = []
    vi.stubGlobal('dispatchEvent', (event: Event) => { events.push(event.type); return true })
    await describePassword('SYNC KEY', signal)
    await storePassword('SYNC KEY', 'secret', signal)
    expect(requests[0]?.url).toBe('roleplay-api/sync/password?ref=SYNC%20KEY')
    expect(requests[1]?.init?.body).toBe('{"ref":"SYNC KEY","value":"secret"}')
    expect(events).toEqual(['roleplay-sync-changed'])
  })

  it('uses a host message for an error, and otherwise the HTTP status', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response(JSON.stringify({ message: 'not configured' }), { status: 409 }))))
    await expect(loadSyncStatus(signal)).rejects.toThrow('not configured')
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response('not json', { status: 502, statusText: 'Bad Gateway' }))))
    await expect(loadSyncStatus(signal)).rejects.toThrow('502 Bad Gateway')
  })
})
