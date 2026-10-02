import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createApiHandler } from '../../../src/host/http/api.ts'
import type { RoleplayRoot } from '../../../src/host/storage/roleplay-root.ts'
import { WorldCatalog } from '../../../src/host/worlds/catalog.ts'
import { API_PREFIX } from '../../../src/shared/worlds.ts'

let base: string
let server: Server
let origin: string
let allowed = true

beforeEach(async () => {
  base = await mkdtemp(join(tmpdir(), 'api-'))
  allowed = true
  const folder = join(base, 'worlds', 'harbor')
  await mkdir(join(folder, 'media', 'files'), { recursive: true })
  await writeFile(join(folder, 'world.json'), JSON.stringify({ name: 'Harbor', metadata: { tags: ['noir'] }, cover_media_id: 'm' }))
  await writeFile(join(folder, 'media', 'manifest.jsonl'), '{"id":"m","file":"media/files/m.png"}\n')
  await writeFile(join(folder, 'media', 'files', 'm.png'), 'png-bytes')
  await writeFile(join(base, 'worlds', 'secret.png'), 'secret')

  const worlds = new WorldCatalog(new Context(), { path: base } as RoleplayRoot)
  const handler = createApiHandler({
    worlds,
    connection: { requestRejection: () => (allowed ? undefined : 401) },
  })
  server = createServer((req, res) => { void handler(req, res) })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}/${API_PREFIX}`
})

afterEach(async () => {
  await new Promise(resolve => server.close(resolve))
  await rm(base, { recursive: true, force: true })
})

describe('roleplay API', () => {
  it('lists worlds', async () => {
    const response = await fetch(`${origin}/worlds`)
    expect(response.status).toBe(200)
    const body = await response.json() as { directory: string; worlds: { id: string; name: string; coverVersion?: string }[] }
    expect(body.directory).toBe(join(base, 'worlds'))
    expect(body.worlds).toMatchObject([{ id: 'harbor', name: 'Harbor', tags: ['noir'] }])
    expect(body.worlds[0]?.coverVersion).toBeTruthy()
  })

  it('re-enumerates on POST refresh', async () => {
    await fetch(`${origin}/worlds`)
    const folder = join(base, 'worlds', 'later')
    await mkdir(folder)
    await writeFile(join(folder, 'world.json'), '{"name":"Later"}')
    const cached = await (await fetch(`${origin}/worlds`)).json() as { worlds: unknown[] }
    expect(cached.worlds).toHaveLength(1)
    const refreshed = await (await fetch(`${origin}/worlds/refresh`, { method: 'POST' })).json() as { worlds: unknown[] }
    expect(refreshed.worlds).toHaveLength(2)
  })

  it('serves a cover with a long-lived cache only for its current version', async () => {
    const { worlds } = await (await fetch(`${origin}/worlds`)).json() as { worlds: { coverVersion: string }[] }
    const version = worlds[0]?.coverVersion ?? ''
    const current = await fetch(`${origin}/worlds/cover?id=harbor&v=${version}`)
    expect(current.status).toBe(200)
    expect(current.headers.get('content-type')).toBe('image/png')
    expect(current.headers.get('cache-control')).toContain('immutable')
    expect(await current.text()).toBe('png-bytes')
    const stale = await fetch(`${origin}/worlds/cover?id=harbor&v=old`)
    expect(stale.headers.get('cache-control')).toBe('no-cache')
    await stale.arrayBuffer()
  })

  it('does not serve covers for unknown ids or paths', async () => {
    for (const id of ['missing', '../secret.png', '', 'harbor/../../secret.png']) {
      const response = await fetch(`${origin}/worlds/cover?id=${encodeURIComponent(id)}`)
      expect(response.status).toBe(404)
      await response.arrayBuffer()
    }
  })

  it('refuses unauthenticated requests', async () => {
    allowed = false
    const response = await fetch(`${origin}/worlds`)
    expect(response.status).toBe(401)
    await response.arrayBuffer()
  })

  it('rejects unknown routes and wrong methods', async () => {
    expect((await fetch(`${origin}/nope`)).status).toBe(404)
    const wrong = await fetch(`${origin}/worlds`, { method: 'POST' })
    expect(wrong.status).toBe(405)
    expect(wrong.headers.get('allow')).toBe('GET')
    expect((await fetch(`${origin}/worlds/refresh`)).status).toBe(405)
  })
})
