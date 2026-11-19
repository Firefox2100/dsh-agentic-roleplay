import { describe, expect, it } from 'vitest'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { Readable } from 'node:stream'
import { syncRoutes, type SyncApi } from '../../../src/host/sync/routes.ts'

function respond() {
  const out: { status: number; body: string } = { status: 0, body: '' }
  const res = {
    set statusCode(status: number) { out.status = status },
    setHeader: () => undefined,
    end(body?: string) { out.body = body ?? '' },
  } as unknown as ServerResponse
  return { res, out }
}
const request = (body: unknown) => Object.assign(Readable.from([Buffer.from(JSON.stringify(body))]), { headers: { 'content-type': 'application/json' } }) as unknown as IncomingMessage

const api = (run: () => Promise<{ units: [] }>): SyncApi => ({ run, status: async () => ({ running: false, units: [] }) } as unknown as SyncApi)

describe('a sync run that outlasts its request', () => {
  it('answers with the result when the run is over in time', async () => {
    const { res, out } = respond()
    await syncRoutes(api(async () => ({ units: [] })), 50)['/sync/run']!['POST']!(request({}), res, new URL('http://x/sync/run'))
    expect(out.status).toBe(200)
  })

  it('answers that it is still running, and lets it go on, when it is not', async () => {
    let finished = false
    const { res, out } = respond()
    await syncRoutes(api(async () => { await new Promise(resolve => setTimeout(resolve, 120)); finished = true; return { units: [] } }), 20)['/sync/run']!['POST']!(request({}), res, new URL('http://x/sync/run'))
    expect(out.status).toBe(202)
    expect(JSON.parse(out.body)).toEqual({ running: true })
    expect(finished).toBe(false)
    await new Promise(resolve => setTimeout(resolve, 200))
    expect(finished).toBe(true)
  })

  it('still reports a refusal at once', async () => {
    const { res, out } = respond()
    const { SyncRefusedError } = await import('../../../src/host/sync/errors.ts')
    await syncRoutes(api(async () => { throw new SyncRefusedError('a sync is already running') }), 50)['/sync/run']!['POST']!(request({}), res, new URL('http://x/sync/run'))
    expect(out.status).toBe(409)
  })
})
