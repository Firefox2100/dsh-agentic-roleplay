import { mkdir, mkdtemp, readdir, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { helpersOf, purgeChat, sessionFolderOf, type PurgeDeps, type StoredHeader } from '../../../src/host/agent/purge.ts'

let root: string
let headers: StoredHeader[]
let events: string[]
let quietError: Error | undefined
const CWD = '/home/x/workspace/dsh-roleplay'
const chat = 'session-aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'

async function store(header: StoredHeader, files = ['session.v4.jsonl.zstd']): Promise<void> {
  const folder = sessionFolderOf(root, header)
  await mkdir(folder, { recursive: true })
  for (const file of files) await writeFile(join(folder, file), 'x')
  headers.push(header)
}
const deps = (extra: Partial<PurgeDeps> = {}): PurgeDeps => ({
  storeRoot: () => root,
  stored: () => ({ list: () => Promise.resolve(headers.map(header => ({ header }))) }),
  quiet: (id) => { events.push(`quiet ${id}`); return quietError === undefined ? Promise.resolve() : Promise.reject(quietError) },
  removed: (id) => { events.push(`removed ${id}`) },
  ...extra,
})
const project = () => join(root, '--home-x-workspace-dsh-roleplay--')

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'purge-'))
  headers = []
  events = []
  quietError = undefined
})
afterEach(async () => { await rm(root, { recursive: true, force: true }) })

describe('where DSH keeps a session', () => {
  it('is a folder of the session\'s own under a folder of its project, named as DSH names them', () => {
    expect(sessionFolderOf('/store', { id: chat, cwd: CWD })).toBe(`/store/--home-x-workspace-dsh-roleplay--/${chat}`)
    expect(sessionFolderOf('/store', { id: chat })).toBe(`/store/_no-cwd/${chat}`)
    expect(sessionFolderOf('/store', { id: 'a/b', cwd: '/my project/é' })).toBe('/store/--my~0020project-~00E9--/a~002Fb')
  })

  it('finds what a chat started, to any depth, and not what only has it as a parent: a branch is a session of its own', () => {
    const all: StoredHeader[] = [
      { id: chat }, { id: 'c1', origin: 'subagent', parentSession: chat }, { id: 'c2', origin: 'subagent', parentSession: 'c1' },
      { id: 'branch', parentSession: chat }, { id: 'other', origin: 'subagent', parentSession: 'x' },
    ]
    expect(helpersOf(all, chat).map(header => header.id)).toEqual(['c1', 'c2'])
  })
})

describe('removing a chat for good', () => {
  it('removes the chat and everything it started, after stopping it, and tells the browser of each; other sessions stay', async () => {
    await store({ id: chat, cwd: CWD })
    await store({ id: 'child-1', cwd: CWD, origin: 'subagent', parentSession: chat })
    await store({ id: 'child-2', cwd: CWD, origin: 'subagent', parentSession: 'child-1' })
    await store({ id: 'session-bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', cwd: CWD })
    await store({ id: 'stranger', cwd: CWD, origin: 'subagent', parentSession: 'session-bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' })
    expect(await purgeChat(deps(), chat)).toEqual(['child-2', 'child-1', chat])
    expect(events).toEqual([`quiet ${chat}`, 'removed child-2', 'removed child-1', `removed ${chat}`])
    expect((await readdir(project())).sort()).toEqual(['session-bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'stranger'])
  })

  it('forgets what DSH read of each session when it keeps a cache of it', async () => {
    await store({ id: chat, cwd: CWD })
    await store({ id: 'child-1', cwd: CWD, origin: 'subagent', parentSession: chat })
    const forgotten: string[] = []
    await purgeChat(deps({ projection: () => ({ whenIdle: () => Promise.resolve(), delete: (id: string) => { forgotten.push(id); return Promise.resolve() } }) }), chat)
    expect(forgotten).toEqual(['child-1', chat])
  })

  it('does not need the cache to be able to forget a session: stock DSH\'s cannot', async () => {
    await store({ id: chat, cwd: CWD })
    expect(await purgeChat(deps({ projection: () => ({ whenIdle: () => Promise.resolve() }) }), chat)).toEqual([chat])
  })

  it('removes nothing when the store cannot be listed or the chat cannot be stopped', async () => {
    await store({ id: chat, cwd: CWD })
    await expect(purgeChat(deps({ stored: () => undefined }), chat)).rejects.toThrow(/cannot be listed/)
    quietError = new Error('still busy')
    await expect(purgeChat(deps(), chat)).rejects.toThrow('still busy')
    expect(await readdir(project())).toEqual([chat])
  })

  it('removes a chat whose folder is already gone as done, and a chat DSH does not know as nothing', async () => {
    await store({ id: chat, cwd: CWD })
    await rm(sessionFolderOf(root, { id: chat, cwd: CWD }), { recursive: true })
    expect(await purgeChat(deps(), chat)).toEqual([])
    expect(await purgeChat(deps(), 'session-unknown')).toEqual([])
  })

  it('only removes a folder that is plainly the session\'s own: not through a link, and with a session log in it; the rest is still tried, and the failure is said', async () => {
    await store({ id: chat, cwd: CWD })
    await store({ id: 'child-1', cwd: CWD, origin: 'subagent', parentSession: chat }, ['notes.txt'])
    await store({ id: 'child-2', cwd: CWD, origin: 'subagent', parentSession: chat })
    const link = sessionFolderOf(root, { id: 'child-2', cwd: CWD })
    await rm(link, { recursive: true })
    const elsewhere = await mkdtemp(join(tmpdir(), 'purge-elsewhere-'))
    await writeFile(join(elsewhere, 'session.v4.jsonl.zstd'), 'precious')
    await symlink(elsewhere, link)
    await expect(purgeChat(deps(), chat)).rejects.toThrow(/removed\)?: .*child-2: refusing to delete .* not a plain folder; child-1: refusing to delete .* no session log|2 of 3 removed|1 of 3 removed/)
    expect(await readdir(elsewhere)).toEqual(['session.v4.jsonl.zstd'])
    expect(await readdir(project())).toContain('child-1')
    await rm(elsewhere, { recursive: true })
  })
})
