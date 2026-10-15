import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createSessionStore, type SessionStore } from '@dsh-agentic-roleplay/state'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { interfaceRoutes, sendPackFile, FRAME_FILES, PACK_FILES } from '../../../src/host/interface/routes.ts'
import { InterfaceService } from '../../../src/host/interface/service.ts'
import { copyWorldPacks, inheritPacks } from '../../../src/host/interface/packs.ts'
import { emptyTimeline, type Timeline } from '../../../src/shared/timeline.ts'
import { writeTimeline } from '../../../src/host/timeline/file.ts'

const ID = '0b8d9a52-2a39-4c10-9d3e-6a1f4d1a7c11'
let root: string
let store: SessionStore
let server: Server
let origin: string

const write = (path: string, text: string): void => { mkdirSync(join(path, '..'), { recursive: true }); writeFileSync(path, text) }
const pack = (base: string, id = 'gothic', extra: Record<string, unknown> = {}): void => {
  write(join(base, 'ui', id, 'pack.json'), JSON.stringify({ name: 'Gothic', actions: ['say'], skin: 'skin.css', surfaces: { hud: { file: 'hud.html' }, tab: { file: 'map.html', title: 'Map' } }, ...extra }))
  write(join(base, 'ui', id, 'skin.css'), '[data-rp="utterance"] { color: red }')
  write(join(base, 'ui', id, 'hud.html'), '<!doctype html><html><head><title>x</title></head><body><script src="app.js"></script></body></html>')
  write(join(base, 'ui', id, 'map.html'), '<p>map</p>')
  write(join(base, 'ui', id, 'app.js'), 'console.log(1)')
}

beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), 'ifc-'))
  mkdirSync(join(root, 'sessions', ID), { recursive: true })
  store = createSessionStore(join(root, 'sessions', ID, 'session.sqlite'), { id: ID, name: 'A story', world: { id: 'w', name: 'W' } })
  const api = new InterfaceService({ open: () => store, root: () => root, wall: () => 0, worldDirectory: async () => join(root, 'worlds', 'harbor') })
  const routes = interfaceRoutes(api)
  server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost')
    if (url.pathname.startsWith(PACK_FILES) || url.pathname.startsWith(FRAME_FILES)) { void sendPackFile(api, url.pathname, res); return }
    const route = routes[url.pathname]?.[req.method ?? '']
    if (route === undefined) { res.statusCode = 404; res.end(); return }
    void route(req, res, url).catch((error: unknown) => { res.statusCode = 500; res.end(String(error)) })
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})
afterEach(async () => { await new Promise(resolve => server.close(resolve)); store.close(); rmSync(root, { recursive: true, force: true }) })

describe('the interface routes', () => {
  it('say there is no pack when the story carries none', async () => {
    expect(await (await fetch(`${origin}/sessions/interface?id=${ID}`)).json()).toEqual({ pack: null, problems: [] })
  })

  it('describe the pack of the story, with its skin pointing at the file route', async () => {
    pack(join(root, 'sessions', ID))
    const payload = await (await fetch(`${origin}/sessions/interface?id=${ID}`)).json() as { pack: { id: string; skin: string; surfaces: Record<string, unknown> } }
    expect(payload.pack.id).toBe('gothic')
    expect(Object.keys(payload.pack.surfaces)).toEqual(['hud', 'tab'])
    expect(payload.pack.skin).toContain('[data-rp="utterance"]')
  })

  it('say what is wrong with a pack that cannot be used', async () => {
    pack(join(root, 'sessions', ID), 'gothic', { api: 9 })
    const payload = await (await fetch(`${origin}/sessions/interface?id=${ID}`)).json() as { pack: null; problems: { message: string }[] }
    expect(payload.pack).toBeNull()
    expect(payload.problems[0]?.message).toContain('api 1')
  })

  it('serve a page with the bridge put in and the policy that closes it, and other files as they are', async () => {
    pack(join(root, 'sessions', ID))
    const page = await fetch(`${origin}${PACK_FILES}${ID}/hud.html`)
    const text = await page.text()
    expect(page.status).toBe(200)
    expect(text.indexOf('window.rp')).toBeGreaterThan(text.indexOf('<head>'))
    expect(text.indexOf('window.rp')).toBeLessThan(text.indexOf('<script src="app.js">'))
    const policy = page.headers.get('content-security-policy') ?? ''
    expect(policy).toContain('sandbox allow-scripts')
    expect(policy).toContain("connect-src 'self'")
    expect(policy).toContain("worker-src 'self' blob:")
    expect(policy).toContain("'wasm-unsafe-eval'")
    expect(page.headers.get('x-content-type-options')).toBe('nosniff')
    expect(page.headers.get('access-control-allow-origin')).toBeNull()
    const script = await fetch(`${origin}${PACK_FILES}${ID}/app.js`)
    expect(await script.text()).toBe('console.log(1)')
    expect(script.headers.get('content-type')).toContain('javascript')
  })

  it('give a surface its files by a key in the address, the same key for the same story and none for a story that is not one', async () => {
    pack(join(root, 'sessions', ID))
    const payload = await (await fetch(`${origin}/sessions/interface?id=${ID}`)).json() as { pack: { frame: string } }
    expect(payload.pack.frame).toMatch(/^[\w-]{32}$/)
    expect(((await (await fetch(`${origin}/sessions/interface?id=${ID}`)).json()) as { pack: { frame: string } }).pack.frame).toBe(payload.pack.frame)
    const style = await fetch(`${origin}${FRAME_FILES}${payload.pack.frame}/skin.css`)
    expect(style.status).toBe(200)
    expect(style.headers.get('content-security-policy')).toContain("connect-src 'self'")
    expect(style.headers.get('access-control-allow-origin')).toBe('*')
    expect((await fetch(`${origin}${FRAME_FILES}${payload.pack.frame}x/skin.css`)).status).toBe(404)
    expect((await fetch(`${origin}${FRAME_FILES}${ID}/skin.css`)).status).toBe(404)
  })

  it('refuse a path that leads out of the pack, and a file the pack does not have', async () => {
    pack(join(root, 'sessions', ID))
    for (const path of ['nothing.png', '..%2Fsession.sqlite', '%2e%2e/%2e%2e/session.sqlite', 'pack.json%00']) {
      expect((await fetch(`${origin}${PACK_FILES}${ID}/${path}`)).status, path).toBe(404)
    }
    expect((await fetch(`${origin}${PACK_FILES}not-a-session/hud.html`)).status).toBe(404)
  })

  it('answer a poll of the view with the view, and "unchanged" when the revision is the one held', async () => {
    const first = await (await fetch(`${origin}/sessions/interface/view?id=${ID}`)).json() as { view: { revision: string; story: { name: string } } }
    expect(first.view.story.name).toBe('A story')
    expect(await (await fetch(`${origin}/sessions/interface/view?id=${ID}&revision=${first.view.revision}`)).json()).toEqual({ unchanged: true })
  })

  it('give the story so far as the story stands: the turns up to the head, with what was told, and not the ones taken back', async () => {
    expect(await (await fetch(`${origin}/sessions/interface/history?id=${ID}`)).json()).toEqual([])
    const timeline: Timeline = { ...emptyTimeline(), head: 't4', next: 5, nodes: [
      { id: 't1', parent: null, turn: 1, userSeq: 3, player: 'I look around.', createdAt: 'x', output: { repaired: false, segments: [{ type: 'narration', text: 'Rain.' }, { type: 'utterance', character: 'clara', name: 'Clara', text: 'Welcome.' }] } },
      { id: 't2', parent: 't1', turn: 2, userSeq: 9, player: '/ask who is here?', createdAt: 'x', output: { repaired: false, segments: [], ooc: { legal: true, note: 'Clara and Eleanor.', question: true } } },
      { id: 't4', parent: 't2', turn: 3, userSeq: 15, player: 'Still running.', createdAt: 'x' },
      { id: 't3', parent: 't1', turn: 2, userSeq: 12, player: 'I leave.', createdAt: 'x', output: { repaired: false, segments: [{ type: 'narration', text: 'Away.' }] } },
    ] }
    writeTimeline(join(root, 'sessions', ID), timeline)
    const turns = await (await fetch(`${origin}/sessions/interface/history?id=${ID}`)).json() as { turn: number; player: string; segments: unknown[]; note?: string }[]
    expect(turns.map(turn => [turn.turn, turn.player])).toEqual([[1, 'I look around.'], [2, '/ask who is here?']])
    expect(turns[0]?.segments).toEqual([{ type: 'narration', text: 'Rain.' }, { type: 'utterance', name: 'Clara', text: 'Welcome.' }])
    expect(turns[1]?.note).toBe('Clara and Eleanor.')
    expect((await (await fetch(`${origin}/sessions/interface/history?id=${ID}&limit=1`)).json() as unknown[]).length).toBe(1)
    expect((await fetch(`${origin}/sessions/interface/history?id=nope`)).status).toBe(404)
  })

  it('keep what a pack stores, within its limit', async () => {
    pack(join(root, 'sessions', ID))
    const post = async (body: unknown) => await fetch(`${origin}/sessions/interface/storage?id=${ID}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
    expect((await post({ op: 'set', key: 'seen', value: { a: [1, 2] } })).status).toBe(200)
    expect(await (await post({ op: 'get', key: 'seen' })).json()).toEqual({ value: { a: [1, 2] } })
    await post({ op: 'remove', key: 'seen' })
    expect(await (await post({ op: 'get', key: 'seen' })).json()).toEqual({ value: null })
    for (let index = 0; index < 6; index += 1) expect((await post({ op: 'set', key: `part${index}`, value: 'x'.repeat(10 * 1024) })).status).toBe(200)
    expect((await post({ op: 'set', key: 'one more', value: 'x'.repeat(10 * 1024) })).status).toBe(422)
    expect((await post({ op: 'get', key: '' })).status).toBe(400)
    expect((await post({ op: 'remove', key: 'x'.repeat(101) })).status).toBe(422)
    expect((await post({ op: 'nope', key: 'k' })).status).toBe(400)
  })

  it('say whether any pack with a tab exists', async () => {
    expect(await (await fetch(`${origin}/interface/availability`)).json()).toEqual({ tab: false })
    pack(join(root, 'worlds', 'harbor'))
    expect(await (await fetch(`${origin}/interface/availability`)).json()).toEqual({ tab: true })
  })
})

describe('the pack settings of a story', () => {
  const status = async () => await (await fetch(`${origin}/sessions/interface/status?id=${ID}`)).json() as { setting: string; active?: string; problems: { message: string }[]; available: { id: string; from: string; surfaces: string[]; problems: unknown[] }[]; world?: { name: string; packs: { id: string; state: string }[] } }
  const sync = async () => await fetch(`${origin}/sessions/interface/sync?id=${ID}`, { method: 'POST' })
  const world = (): string => join(root, 'worlds', 'harbor')
  const story = (): string => join(root, 'sessions', ID)

  it('lists the packs the story can use, its own and those of the root, and the one in use', async () => {
    pack(story())
    pack(root, 'mine')
    const found = await status()
    expect(found.active).toBe('gothic')
    expect(found.available.map(entry => [entry.id, entry.from, entry.surfaces])).toEqual([['gothic', 'story', ['hud', 'tab']], ['mine', 'root', ['hud', 'tab']]])
    expect(found).toMatchObject({ setting: '', problems: [], world: { name: 'W', packs: [] } })
  })

  it('says why the pack asked for cannot be used', async () => {
    pack(story(), 'gothic', { api: 9 })
    const found = await status()
    expect(found.active).toBeUndefined()
    expect(found.problems[0]?.message).toContain('api 1')
    expect(found.available[0]?.problems).not.toEqual([])
  })

  it('compares the packs of the world with the copies of the story', async () => {
    pack(world(), 'same')
    pack(story(), 'same')
    pack(world(), 'changed')
    pack(story(), 'changed')
    write(join(world(), 'ui', 'changed', 'hud.html'), '<p>newer</p>')
    pack(world(), 'fresh')
    const found = await status()
    expect(found.world?.packs.map(entry => [entry.id, entry.state])).toEqual([['changed', 'different'], ['fresh', 'new'], ['same', 'same']])
  })

  it('brings the new and the changed packs of the world in, keeps the old copy aside, and leaves the rest', async () => {
    pack(world(), 'same'); pack(story(), 'same')
    pack(world(), 'changed'); pack(story(), 'changed')
    write(join(world(), 'ui', 'changed', 'hud.html'), '<p>newer</p>')
    write(join(story(), 'ui', 'changed', 'hud.html'), '<p>older</p>')
    pack(world(), 'fresh')
    const done = await (await sync()).json()
    expect(done).toEqual({ updated: ['changed'], added: ['fresh'], unchanged: ['same'] })
    expect(readFileSync(join(story(), 'ui', 'changed', 'hud.html'), 'utf8')).toBe('<p>newer</p>')
    expect(existsSync(join(story(), 'ui', 'fresh', 'pack.json'))).toBe(true)
    const aside = readdirSync(join(story(), '.trash', 'ui'))
    expect(aside).toHaveLength(1)
    expect(readFileSync(join(story(), '.trash', 'ui', aside[0] as string, 'hud.html'), 'utf8')).toBe('<p>older</p>')
    expect(await (await sync()).json()).toEqual({ updated: [], added: [], unchanged: ['changed', 'fresh', 'same'] })
  })

  it('refuses when a pack of the world has problems, and changes nothing', async () => {
    pack(world(), 'good'); pack(world(), 'broken', { api: 3 })
    const response = await sync()
    expect(response.status).toBe(422)
    expect((await response.json() as { problems: { message: string }[] }).problems[0]?.message).toContain('api 1')
    expect(existsSync(join(story(), 'ui'))).toBe(false)
  })
})

describe('the packs of a world', () => {
  it('are copied into the session when they are all right, and refuse the start with every problem when not', () => {
    const world = join(root, 'worlds', 'harbor')
    pack(world)
    expect(copyWorldPacks(world, join(root, 'sessions', ID))).toEqual([])
    expect(new InterfaceService({ open: () => store, root: () => root, worldDirectory: async () => join(root, 'worlds', 'harbor') }).describe(ID).pack?.id).toBe('gothic')
    write(join(world, 'ui', 'bad', 'pack.json'), '{ "api": 3 }')
    const problems = copyWorldPacks(world, join(root, 'sessions', 'other'))
    expect(problems.map(problem => problem.message)).toEqual([expect.stringContaining('api 1')])
    expect(problems[0]?.path).toContain(join('ui', 'bad', 'pack.json'))
  })

  it('go to a branch', () => {
    pack(join(root, 'sessions', ID))
    inheritPacks(join(root, 'sessions', ID), join(root, 'sessions', 'branch'))
    expect(new InterfaceService({ open: () => store, root: () => root, worldDirectory: async () => join(root, 'worlds', 'harbor') }).availability()).toEqual({ tab: true })
  })
})
