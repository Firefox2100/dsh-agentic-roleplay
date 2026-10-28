import { createHash } from 'node:crypto'
import { mkdir as mkdirp, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Catalogue } from '../../../src/host/catalogue/service.ts'
import { Sources } from '../../../src/host/catalogue/sources.ts'
import type { Ask, Reply, Transport } from '../../../src/host/catalogue/transport.ts'
import type { RoleplayRoot } from '../../../src/host/storage/roleplay-root.ts'
import { WorldCatalog } from '../../../src/host/worlds/catalog.ts'
import type { CatalogueSource } from '../../../src/shared/catalogue.ts'
import { makeZip, worldZip } from '../../support/zip.ts'

interface Call { url: string; authorization: string | undefined; guarded: boolean }

let root: string
let worlds: WorldCatalog
let calls: Call[]
let answers: Record<string, (ask: Ask) => Partial<Reply>>
let configured: CatalogueSource[]

const json = (value: unknown): Partial<Reply> => ({ status: 200, type: 'application/json', body: Buffer.from(JSON.stringify(value)) })
const zip = (archive: Buffer): Partial<Reply> => ({ status: 200, type: 'application/zip', body: archive })
const transport: Transport = async (url, ask) => {
  calls.push({ url: url.href, authorization: ask.headers['authorization'], guarded: ask.guarded })
  const answer = answers[url.href] ?? answers[url.origin + url.pathname]
  const reply = answer === undefined ? { status: 404 } : answer(ask)
  return { status: 200, type: '', location: undefined, body: Buffer.alloc(0), ...reply }
}
let converted: { file: Buffer; name: string; language: string | undefined }[]
let presets: { file: Buffer; title: string; language: string | undefined }[]
let lorebooks: { file: Buffer; title: string; language: string | undefined }[]
let staged: { kind: string; file: Buffer; name: string }[]
let cardsStaged: { file: Buffer; name: string }[]
let cardsStarted: { id: string; choices: unknown; language: string | undefined; update?: string | undefined }[]
const problems: string[] = []
const make = (): Catalogue => new Catalogue({
  sources: new Sources(() => configured), worlds, maxBytes: () => 1024 * 1024, maxCardBytes: () => 1024 * 1024, trashDays: () => 30, problem: (message) => { problems.push(message) }, transport,
  stage: (kind, file, name) => { staged.push({ kind, file, name }); return { id: 'st-1', kind, name, items: [] } },
  previewCard: async (file, name) => { cardsStaged.push({ file, name }); return { id: 'card-1', hasAvatar: false, choices: { name: 'Ann', disabledEntries: [], opening: { kind: 'first' } }, card: {} as never } },
  startCard: async (id, choices, language, update) => {
    cardsStarted.push({ id, choices, language, ...(update === undefined ? {} : { update }) })
    const made = await worlds.list({ refresh: true })
    return { worldId: made.worlds[0]?.id ?? '', chatSessionId: 'chat-4', started: true }
  },
  importPreset: async (file, title, language) => { presets.push({ file, title, language }); return { name: 'imported', chatSessionId: 'chat-2', started: true } },
  importLorebook: async (file, title, language) => { lorebooks.push({ file, title, language }); return { name: 'imported-book', chatSessionId: 'chat-3', started: true } },
  importCard: async (file, name, language) => {
    converted.push({ file, name, language })
    const made = await worlds.list({ refresh: true })
    return { worldId: made.worlds[0]?.id ?? '', chatSessionId: 'chat-1', started: true }
  },
})

const item = (id: string, name: string, visibility = 'public') => ({ id, authorUsername: 'ann', coverImageResourceId: id === 'w1' ? 'img' : null, viewCount: 3, downloadCount: 1, metadata: { name, description: 'A place', language: 'en-uk', visibility, tags: ['noir'] } })
const WORLD = { id: 'world-uuid', name: 'Harbor', version: '2', metadata: { tags: ['noir'] } }

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'catalogue-'))
  worlds = new WorldCatalog(new Context(), { path: root } as RoleplayRoot)
  calls = []
  converted = []
  cardsStaged = []
  cardsStarted = []
  presets = []
  staged = []
  lorebooks = []
  answers = {}
  configured = [{ name: 'Home', baseUrl: 'http://localhost:9798', apiKeyRef: '', apiKey: 'secret' }, { name: 'Open', baseUrl: 'https://open.example/api', apiKeyRef: '', apiKey: '' }]
})
afterEach(async () => { await rm(root, { recursive: true, force: true }) })

describe('browsing a catalogue', () => {
  it('lists published worlds with the key when there is one, and without it when there is none', async () => {
    answers['http://localhost:9798/resources'] = () => json({ items: [item('w1', 'Harbor'), item('w2', 'Hidden', 'private')], nextOffset: 24 })
    answers['https://open.example/api/resources'] = () => json({ items: [] })
    const home = await make().worlds('Home', { search: ' fog ', offset: 24, sort: 'popular' })
    expect(home).toMatchObject({ withKey: true, nextOffset: 24, items: [{ id: 'w1', name: 'Harbor', hasCover: true, visibility: 'public', tags: ['noir'] }, { id: 'w2', visibility: 'private', hasCover: false }] })
    const url = new URL(calls[0]!.url)
    expect(Object.fromEntries(url.searchParams)).toEqual({ resourceType: 'dsh-agentic-roleplay/world', publishedOnly: 'true', limit: '24', offset: '24', sort: 'popular', search_string: 'fog' })
    expect(calls[0]).toMatchObject({ authorization: 'Bearer secret', guarded: false })

    expect(await make().worlds('Open', {})).toMatchObject({ withKey: false, items: [] })
    expect(calls[1]).toMatchObject({ authorization: undefined, guarded: false })
  })

  it('follows the key as it is edited, with nothing remembered', async () => {
    answers['http://localhost:9798/resources'] = ask => json({ items: ask.headers['authorization'] === undefined ? [] : [item('w2', 'Hidden', 'private')] })
    const catalogue = make()
    expect((await catalogue.worlds('Home', {})).items).toHaveLength(1)
    configured = [{ name: 'Home', baseUrl: 'http://localhost:9798', apiKeyRef: '', apiKey: '' }]
    expect(await catalogue.worlds('Home', {})).toMatchObject({ withKey: false, items: [] })
    expect(await catalogue.sources()).toEqual([{ name: 'Home', baseUrl: 'http://localhost:9798', hasKey: false, keyRef: 'ROLEPLAY_CATALOGUE_HOME_API_KEY' }])
  })

  it('says what is wrong when the catalogue refuses, is not reachable, or is not a catalogue', async () => {
    answers['http://localhost:9798/resources'] = () => ({ status: 401 })
    await expect(make().worlds('Home', {})).rejects.toThrow(/refused the API key/)
    answers['https://open.example/api/resources'] = () => ({ status: 401 })
    await expect(make().worlds('Open', {})).rejects.toThrow(/needs an API key/)
    answers['https://open.example/api/resources'] = () => ({ status: 200, type: 'text/html', body: Buffer.from('<html>') })
    await expect(make().worlds('Open', {})).rejects.toThrow(/not JSON/)
    answers['https://open.example/api/resources'] = () => json({ nothing: true })
    await expect(make().worlds('Open', {})).rejects.toThrow(/no items/)
    await expect(make().worlds('Nowhere', {})).rejects.toMatchObject({ failure: 'unknown' })
  })

  it('shows a world with its releases newest first, and whether the person has it', async () => {
    answers['http://localhost:9798/resources/w1'] = () => json(item('w1', 'Harbor'))
    answers['http://localhost:9798/versions/resource/w1'] = () => json([
      { id: 'v1', version: '1', versionNumber: 1, publishedAt: '2026-01-01T00:00:00Z', visibility: 'public', artifactByteSize: 10, artifactSha256: 'aa' },
      { id: 'v2', version: '2', versionNumber: 2, publishedAt: '2026-02-01T00:00:00Z', visibility: 'public' },
    ])
    answers['http://localhost:9798/versions/v2/data'] = () => json({ data: { worldId: 'world-uuid' } })
    const catalogue = make()
    expect(await catalogue.world('Home', 'w1')).toMatchObject({ name: 'Harbor', versions: [{ id: 'v2' }, { id: 'v1', byteSize: 10, sha256: 'aa' }] })
    expect((await catalogue.world('Home', 'w1')).installed).toBeUndefined()
    await catalogue.install({ url: 'http://localhost:9798/versions/v2/download' }).catch(() => undefined)
    answers['http://localhost:9798/versions/v2/download'] = () => zip(worldZip('harbor', WORLD))
    answers['http://localhost:9798/versions/v2'] = () => json({ id: 'v2', resourceId: 'w1', version: '2' })
    await catalogue.install({ url: 'http://localhost:9798/versions/v2/download' })
    expect((await catalogue.world('Home', 'w1')).installed).toEqual({ worldId: 'world-uuid', name: 'Harbor', version: '2', versionId: 'v2', modified: false })
    await expect(catalogue.world('Home', '../x')).rejects.toMatchObject({ failure: 'input' })
  })

  it('serves a cover as the picture it is and nothing else', async () => {
    answers['http://localhost:9798/images/covers/resources/w1'] = () => ({ status: 200, type: 'image/png', body: Buffer.from('png') })
    expect(await make().cover('Home', 'w1')).toEqual({ type: 'image/png', body: Buffer.from('png') })
    answers['http://localhost:9798/images/covers/resources/w2'] = () => ({ status: 200, type: 'text/html', body: Buffer.from('<p>') })
    await expect(make().cover('Home', 'w2')).rejects.toThrow(/not a picture/)
  })
})

describe('asking for an address', () => {
  it('sends the key to the site it belongs to and to no other, also across a redirect', async () => {
    answers['http://localhost:9798/versions/v/download'] = () => ({ status: 302, location: 'https://files.example/w.zip' })
    answers['http://localhost:9798/versions/v'] = () => json({ id: 'v', resourceId: 'w1', version: '1' })
    answers['https://files.example/w.zip'] = () => zip(worldZip('harbor', WORLD))
    await make().install({ url: 'http://localhost:9798/versions/v/download' })
    expect(calls).toEqual([
      { url: 'http://localhost:9798/versions/v/download', authorization: 'Bearer secret', guarded: false },
      { url: 'https://files.example/w.zip', authorization: undefined, guarded: true },
      { url: 'http://localhost:9798/versions/v', authorization: 'Bearer secret', guarded: false },
    ])
  })

  it('fetches an address of no configured site plainly, and only a public one', async () => {
    answers['https://elsewhere.example/w.zip'] = () => zip(worldZip('harbor', WORLD))
    await make().install({ url: 'https://elsewhere.example/w.zip' })
    expect(calls).toEqual([{ url: 'https://elsewhere.example/w.zip', authorization: undefined, guarded: true }])
    for (const url of ['http://127.0.0.1/w.zip', 'http://192.168.1.5/w.zip', 'https://elsewhere.example:8443/w.zip', 'ftp://elsewhere.example/w.zip', 'https://user:pw@elsewhere.example/w.zip']) {
      await expect(make().install({ url })).rejects.toMatchObject({ failure: 'input' })
    }
    expect(calls).toHaveLength(1)
  })

  it('explains an answer it cannot use', async () => {
    answers['https://elsewhere.example/gone.zip'] = () => ({ status: 404 })
    await expect(make().install({ url: 'https://elsewhere.example/gone.zip' })).rejects.toThrow(/not found, or it is private and needs an API key/)
    answers['https://elsewhere.example/login.zip'] = () => ({ status: 403 })
    await expect(make().install({ url: 'https://elsewhere.example/login.zip' })).rejects.toThrow(/needs a sign-in.*add its catalogue with an API key/)
    answers['https://elsewhere.example/page'] = () => ({ status: 200, type: 'text/html', body: Buffer.from('<html>') })
    await expect(make().install({ url: 'https://elsewhere.example/page' })).rejects.toThrow(/did not answer with a ZIP archive \(it sent text\/html\)/)
    await expect(make().install({ url: '  ' })).rejects.toMatchObject({ failure: 'input' })
    await expect(make().install({ url: 'not an address' })).rejects.toMatchObject({ failure: 'input' })
  })

  it('stops at a redirect that goes round and round', async () => {
    answers['https://elsewhere.example/loop'] = () => ({ status: 302, location: '/loop' })
    await expect(make().install({ url: 'https://elsewhere.example/loop' })).rejects.toThrow(/too many redirects/)
  })
})

describe('installing a world', () => {
  const at = (path: string, archive: Buffer): void => { answers[`http://localhost:9798${path}`] = () => zip(archive) }

  it('puts the world among the person\'s own, as the worlds list reads it, and says which packs came along', async () => {
    at('/w.zip', worldZip('harbor', WORLD, { 'ui/map/pack.json': '{}', 'ui/map/index.html': '<p>', 'characters/ann/character.json': '{}' }))
    const installed = await make().install({ url: 'http://localhost:9798/w.zip' })
    expect(installed).toMatchObject({ world: { id: 'world-uuid', name: 'Harbor', version: '2' }, packs: ['map'] })
    expect((await readdir(join(root, 'worlds', 'harbor'))).sort()).toEqual(['characters', 'ui', 'world.json'])
    expect((await worlds.list()).worlds.map(world => world.id)).toEqual(['world-uuid'])
    expect(await readdir(join(root, '.install'))).toEqual([])
  })

  it('never replaces a world the person has, and never lets a folder clash overwrite one', async () => {
    at('/w.zip', worldZip('harbor', WORLD))
    await make().install({ url: 'http://localhost:9798/w.zip' })
    const before = await readFile(join(root, 'worlds', 'harbor', 'world.json'), 'utf8')
    await expect(make().install({ url: 'http://localhost:9798/w.zip' })).rejects.toMatchObject({ failure: 'conflict', message: 'you already have "Harbor"' })
    expect(await readFile(join(root, 'worlds', 'harbor', 'world.json'), 'utf8')).toBe(before)

    at('/other.zip', worldZip('harbor', { ...WORLD, id: 'another', name: 'Harbor Two' }))
    expect((await make().install({ url: 'http://localhost:9798/other.zip' })).world.id).toBe('another')
    expect((await readdir(join(root, 'worlds'))).sort()).toEqual(['harbor', 'harbor-2'])
  })

  it('checks the download against the checksum the catalogue published', async () => {
    const archive = worldZip('harbor', WORLD)
    at('/w.zip', archive)
    await expect(make().install({ url: 'http://localhost:9798/w.zip', sha256: '00' })).rejects.toThrow(/does not match the checksum/)
    expect((await worlds.list({ refresh: true })).worlds).toEqual([])
    await make().install({ url: 'http://localhost:9798/w.zip', sha256: createHash('sha256').update(archive).digest('hex').toUpperCase() })
    expect((await worlds.list()).worlds).toHaveLength(1)
  })

  it('refuses an archive that is not a world and leaves nothing behind', async () => {
    const refused: [string, Buffer, RegExp][] = [
      ['no world.json', makeZip([{ name: 'harbor/readme.txt', content: 'x' }]), /one top-level world folder/],
      ['two folders', makeZip([{ name: 'a/world.json', content: '{}' }, { name: 'b/readme', content: 'x' }]), /inside the "a" folder/],
      ['deep world.json', makeZip([{ name: 'a/b/world.json', content: '{}' }]), /one top-level world folder/],
      ['unsafe folder', makeZip([{ name: 'my world/world.json', content: '{}' }]), /unsafe or unsupported name/],
      ['no name', worldZip('harbor', { id: 'x' }), /world\.json is not valid/],
      ['not JSON', makeZip([{ name: 'harbor/world.json', content: '{' }]), /world\.json is not valid/],
      ['path escape', makeZip([{ name: 'harbor/world.json', content: JSON.stringify(WORLD) }, { name: 'harbor/../evil', content: 'x' }]), /archive path/],
    ]
    for (const [, archive, message] of refused) {
      at('/bad.zip', archive)
      await expect(make().install({ url: 'http://localhost:9798/bad.zip' })).rejects.toMatchObject({ failure: 'invalid', message: expect.stringMatching(message) as string })
    }
    expect((await readdir(root)).filter(entry => entry !== '.install')).toEqual([])
  })

  it('refuses a download past the size limit while reading it', async () => {
    const big = makeZip([{ name: 'harbor/world.json', content: JSON.stringify(WORLD) }, { name: 'harbor/blob', content: 'x'.repeat(2 * 1024 * 1024) }])
    at('/big.zip', big)
    await expect(make().install({ url: 'http://localhost:9798/big.zip' })).rejects.toThrow(/unpacks to more than/)
    expect((await worlds.list({ refresh: true })).worlds).toEqual([])
  })
})

describe('updating an installed world', () => {
  const at = (path: string, archive: Buffer): void => { answers[`http://localhost:9798${path}`] = () => zip(archive) }
  const release = (id: string, number: number) => ({ id, resourceId: 'w1', version: `${number}`, versionNumber: number, publishedAt: '2026-01-01T00:00:00Z', visibility: 'public' })
  const versions = (...numbers: number[]): void => {
    answers['http://localhost:9798/versions/resource/w1'] = () => json(numbers.map(number => release(`v${number}`, number)))
    for (const number of numbers) answers[`http://localhost:9798/versions/v${number}`] = () => json(release(`v${number}`, number))
  }
  const installFirst = async (): Promise<void> => {
    versions(1)
    at('/versions/v1/download', worldZip('harbor', { ...WORLD, version: '1' }, { 'notes.txt': 'first' }))
    expect(await make().install({ url: 'http://localhost:9798/versions/v1/download' })).toMatchObject({ tracked: true })
  }
  const secondRelease = (): void => {
    versions(2, 1)
    at('/versions/v2/download', worldZip('harbor', { ...WORLD, version: '2' }, { 'notes.txt': 'second' }))
  }
  const worldFile = async (): Promise<string> => await readFile(join(root, 'worlds', 'harbor', 'notes.txt'), 'utf8')

  it('records the release a world was installed from, and nothing for an address of no catalogue', async () => {
    await installFirst()
    expect(JSON.parse(await readFile(join(root, 'worlds', 'harbor', '.catalogue.json'), 'utf8'))).toMatchObject({ kind: 'release', root: 'http://localhost:9798', resourceId: 'w1', versionId: 'v1', version: '1', files: { 'notes.txt': expect.any(String) as string } })
    answers['https://elsewhere.example/w.zip'] = () => zip(worldZip('other', { ...WORLD, id: 'o', name: 'Other' }))
    expect(await make().install({ url: 'https://elsewhere.example/w.zip' })).toMatchObject({ tracked: false })
  })

  it('offers a newer release only for a world installed from that catalogue, and says whether it was changed', async () => {
    await installFirst()
    expect(await make().updates('Home')).toEqual({ updates: [], problems: [] })
    secondRelease()
    expect(await make().updates('Home')).toMatchObject({ updates: [{ worldId: 'world-uuid', worldName: 'Harbor', installedVersion: '1', latest: { id: 'v2' }, modified: false }], problems: [] })
    expect(await make().updates('Open')).toEqual({ updates: [], problems: [] })
    await writeFile(join(root, 'worlds', 'harbor', 'notes.txt'), 'mine')
    expect((await make().updates('Home')).updates[0]).toMatchObject({ modified: true })
  })

  it('reports a world whose record is damaged instead of skipping it', async () => {
    await installFirst()
    await writeFile(join(root, 'worlds', 'harbor', '.catalogue.json'), '{')
    expect((await make().updates('Home')).problems).toEqual([{ worldName: 'Harbor', message: expect.stringMatching(/damaged/) as string }])
  })

  it('replaces an unchanged world in its own folder and keeps the old files in the trash', async () => {
    await installFirst()
    secondRelease()
    const updated = await make().install({ url: 'http://localhost:9798/versions/v2/download', mode: 'update' })
    expect(updated).toMatchObject({ world: { id: 'world-uuid', version: '2' }, tracked: true, backup: expect.stringMatching(/^\.trash\/worlds\/harbor-/) as string })
    expect(await worldFile()).toBe('second')
    expect(await readFile(join(root, updated.backup!, 'notes.txt'), 'utf8')).toBe('first')
    expect((await readdir(join(root, 'worlds'))).sort()).toEqual(['harbor'])
    expect((await make().updates('Home')).updates).toEqual([])
    answers['http://localhost:9798/resources/w1'] = () => json(item('w1', 'Harbor'))
    answers['http://localhost:9798/versions/v2/data'] = () => json({ data: { worldId: 'world-uuid' } })
    expect(await make().world('Home', 'w1').then(detail => detail.installed)).toMatchObject({ versionId: 'v2', modified: false })
  })

  it('deletes old replaced files past the limit when the next update is made', async () => {
    await installFirst()
    secondRelease()
    const old = join(root, '.trash', 'worlds', 'ancient-2020-01-01T00-00-00-000Z')
    await mkdirp(old, { recursive: true })
    await make().install({ url: 'http://localhost:9798/versions/v2/download', mode: 'update' })
    expect(await readdir(join(root, '.trash', 'worlds'))).toHaveLength(1)
    expect(problems).toEqual([])
  })

  it('refuses to replace a world the person changed unless they say to, and then still keeps what they had', async () => {
    await installFirst()
    secondRelease()
    await writeFile(join(root, 'worlds', 'harbor', 'notes.txt'), 'mine')
    await writeFile(join(root, 'worlds', 'harbor', 'extra.txt'), 'added')
    await expect(make().install({ url: 'http://localhost:9798/versions/v2/download', mode: 'update' })).rejects.toMatchObject({ failure: 'conflict', detail: { reason: 'modified', changes: ['changed: notes.txt', 'added: extra.txt'] } })
    expect(await worldFile()).toBe('mine')
    const updated = await make().install({ url: 'http://localhost:9798/versions/v2/download', mode: 'update', overwriteChanges: true })
    expect(await worldFile()).toBe('second')
    expect(await readFile(join(root, updated.backup!, 'notes.txt'), 'utf8')).toBe('mine')
    expect(await readFile(join(root, updated.backup!, 'extra.txt'), 'utf8')).toBe('added')
  })

  it('cannot tell whether a world with no record was changed, so it asks', async () => {
    at('/w.zip', worldZip('harbor', WORLD, { 'notes.txt': 'first' }))
    await make().install({ url: 'http://localhost:9798/w.zip' })
    versions(2)
    at('/versions/v2/download', worldZip('harbor', WORLD, { 'notes.txt': 'second' }))
    await expect(make().install({ url: 'http://localhost:9798/versions/v2/download', mode: 'update' })).rejects.toMatchObject({ failure: 'conflict', detail: { reason: 'unverified' } })
    await make().install({ url: 'http://localhost:9798/versions/v2/download', mode: 'update', overwriteChanges: true })
    expect(await worldFile()).toBe('second')
  })

  it('puts the release beside the world as a second, separate one, with its own identity', async () => {
    await installFirst()
    secondRelease()
    await writeFile(join(root, 'worlds', 'harbor', 'notes.txt'), 'mine')
    const copy = await make().install({ url: 'http://localhost:9798/versions/v2/download', mode: 'copy' })
    expect(copy).toMatchObject({ world: { name: 'Harbor (copy)' }, tracked: false })
    expect(copy.world.id).not.toBe('world-uuid')
    expect(await readFile(join(root, 'worlds', 'harbor', 'notes.txt'), 'utf8')).toBe('mine')
    expect(await readFile(join(root, 'worlds', 'harbor-2', 'notes.txt'), 'utf8')).toBe('second')
    expect((await worlds.list()).worlds.map(world => world.name).sort()).toEqual(['Harbor', 'Harbor (copy)'])
    expect((await make().updates('Home')).updates).toHaveLength(1)
  })

  it('removes a refused update and puts the old world back', async () => {
    await installFirst()
    versions(2, 1)
    at('/versions/v2/download', makeZip([{ name: 'harbor/world.json', content: JSON.stringify({ ...WORLD, cover_media_id: 5 }) }]))
    await expect(make().install({ url: 'http://localhost:9798/versions/v2/download', mode: 'update' })).rejects.toMatchObject({ failure: 'invalid' })
    expect(await worldFile()).toBe('first')
    expect((await worlds.list({ refresh: true })).worlds.map(world => world.id)).toEqual(['world-uuid'])
  })
})

describe('converting a character card', () => {
  const CARD = JSON.stringify({ spec: 'chara_card_v3', data: { name: 'Ann' } })
  const version = (extra: Record<string, unknown> = {}) => ({ id: 'cv1', resourceId: 'c1', resourceType: 'sillytavern/character', version: '3', ...extra })

  it('downloads the card with the catalogue\'s key, hands it to the importer, and notes that the world came from it', async () => {
    answers['http://localhost:9798/versions/cv1'] = () => json(version({ artifactSha256: createHash('sha256').update(CARD).digest('hex') }))
    answers['http://localhost:9798/versions/cv1/download'] = () => ({ status: 200, type: 'application/json', body: Buffer.from(CARD) })
    answers['http://localhost:9798/resources/c1'] = () => json({ ...item('c1', 'Ann'), resourceType: 'sillytavern/character' })
    answers['http://localhost:9798/versions/resource/c1'] = () => json([{ id: 'cv1', version: '3', versionNumber: 1, publishedAt: '2026-01-01T00:00:00Z', visibility: 'public' }])
    await worlds.list({ refresh: true })
    await mkdirp(join(root, 'worlds', 'made'), { recursive: true })
    await writeFile(join(root, 'worlds', 'made', 'world.json'), JSON.stringify({ id: 'made-id', name: 'Ann' }))
    const result = await make().convert({ source: 'Home', versionId: 'cv1', language: 'en' })
    expect(result).toEqual({ worldId: 'made-id', chatSessionId: 'chat-1', started: true })
    expect(converted).toEqual([{ file: Buffer.from(CARD), name: 'cv1.json', language: 'en' }])
    expect(calls.filter(call => call.url.endsWith('/download'))[0]).toMatchObject({ authorization: 'Bearer secret' })
    expect(JSON.parse(await readFile(join(root, 'worlds', 'made', '.catalogue.json'), 'utf8'))).toEqual({ kind: 'card', root: 'http://localhost:9798', resourceId: 'c1', versionId: 'cv1', version: '3' })

    const detail = await make().world('Home', 'c1')
    expect(detail).toMatchObject({ kind: 'card', converted: [{ worldId: 'made-id', name: 'Ann', version: '3' }] })
    expect(detail.installed).toBeUndefined()
    expect((await make().updates('Home')).updates).toEqual([])
  })

  it('refuses a release that is not a card, a download that is not the published one, and a card that is too large', async () => {
    answers['http://localhost:9798/versions/cv1'] = () => json(version({ resourceType: 'dsh-agentic-roleplay/world' }))
    await expect(make().convert({ source: 'Home', versionId: 'cv1' })).rejects.toMatchObject({ failure: 'invalid', message: 'that release is not a character card' })
    answers['http://localhost:9798/versions/cv1'] = () => json(version({ artifactSha256: '00' }))
    answers['http://localhost:9798/versions/cv1/download'] = () => ({ status: 200, type: 'application/json', body: Buffer.from(CARD) })
    await expect(make().convert({ source: 'Home', versionId: 'cv1' })).rejects.toThrow(/does not match the checksum/)
    expect(converted).toEqual([])
  })

  it('offers a downloaded card for choosing and makes the world with the choices, noting where it came from, without a second download', async () => {
    answers['http://localhost:9798/versions/cv1'] = () => json(version({ artifactSha256: createHash('sha256').update(CARD).digest('hex') }))
    answers['http://localhost:9798/versions/cv1/download'] = () => ({ status: 200, type: 'application/json', body: Buffer.from(CARD) })
    expect(await make().stageCard({ source: 'Home', versionId: 'cv1' })).toMatchObject({ id: 'card-1' })
    expect(cardsStaged).toEqual([{ file: Buffer.from(CARD), name: 'cv1.json' }])
    expect(converted).toEqual([])
    await mkdirp(join(root, 'worlds', 'made'), { recursive: true })
    await writeFile(join(root, 'worlds', 'made', 'world.json'), JSON.stringify({ id: 'made-id', name: 'Ann' }))
    const choices = { name: 'Ann (mine)', disabledEntries: ['2'], opening: { kind: 'none' as const } }
    expect(await make().convertStaged({ source: 'Home', versionId: 'cv1', id: 'card-1', choices, language: 'zh' })).toEqual({ worldId: 'made-id', chatSessionId: 'chat-4', started: true })
    expect(cardsStarted).toEqual([{ id: 'card-1', choices, language: 'zh' }])
    expect(calls.filter(call => call.url.endsWith('/download'))).toHaveLength(1)
    expect(JSON.parse(await readFile(join(root, 'worlds', 'made', '.catalogue.json'), 'utf8'))).toEqual({ kind: 'card', root: 'http://localhost:9798', resourceId: 'c1', versionId: 'cv1', version: '3' })
  })

  it('passes the world a staged card is to update and records the new release as its origin', async () => {
    answers['http://localhost:9798/versions/cv1'] = () => json(version({ artifactSha256: createHash('sha256').update(CARD).digest('hex') }))
    await mkdirp(join(root, 'worlds', 'made'), { recursive: true })
    await writeFile(join(root, 'worlds', 'made', 'world.json'), JSON.stringify({ id: 'made-id', name: 'Ann' }))
    const choices = { name: 'Ann', disabledEntries: [], opening: { kind: 'none' as const } }
    await make().convertStaged({ source: 'Home', versionId: 'cv1', id: 'card-1', choices, update: 'made-id' })
    expect(cardsStarted).toEqual([{ id: 'card-1', choices, language: undefined, update: 'made-id' }])
    expect(JSON.parse(await readFile(join(root, 'worlds', 'made', '.catalogue.json'), 'utf8'))).toMatchObject({ kind: 'card', versionId: 'cv1' })
  })

  it('makes nothing when the release is not a card', async () => {
    answers['http://localhost:9798/versions/cv1'] = () => json(version({ resourceType: 'dsh-agentic-roleplay/world' }))
    await expect(make().stageCard({ source: 'Home', versionId: 'cv1' })).rejects.toMatchObject({ failure: 'invalid' })
    await expect(make().convertStaged({ source: 'Home', versionId: 'cv1', id: 'card-1', choices: { name: 'x', disabledEntries: [], opening: { kind: 'first' } } })).rejects.toMatchObject({ failure: 'invalid' })
    expect(cardsStarted).toEqual([])
  })
})

describe('importing a SillyTavern preset', () => {
  const PRESET = JSON.stringify({ prompts: [{ identifier: 'main', content: 'Write.' }] })
  const version = (extra: Record<string, unknown> = {}) => ({ id: 'pv1', resourceId: 'p1', resourceType: 'sillytavern/preset', version: '1', ...extra })

  it('downloads it with the catalogue\'s key and hands it to the library under the entry\'s title', async () => {
    answers['http://localhost:9798/versions/pv1'] = () => json(version({ artifactSha256: createHash('sha256').update(PRESET).digest('hex') }))
    answers['http://localhost:9798/versions/pv1/download'] = () => ({ status: 200, type: 'application/json', body: Buffer.from(PRESET) })
    const result = await make().convertPreset({ source: 'Home', versionId: 'pv1', title: 'Noir', language: 'en' })
    expect(result).toEqual({ name: 'imported', chatSessionId: 'chat-2', started: true })
    expect(presets).toEqual([{ file: Buffer.from(PRESET), title: 'Noir', language: 'en' }])
    expect(calls.filter(call => call.url.endsWith('/download'))[0]).toMatchObject({ authorization: 'Bearer secret' })
  })

  it('downloads a preset or a lorebook to be staged, so the person can choose before anything is imported, and checks its kind', async () => {
    answers['http://localhost:9798/versions/pv1'] = () => json(version({ artifactSha256: createHash('sha256').update(PRESET).digest('hex') }))
    answers['http://localhost:9798/versions/pv1/download'] = () => ({ status: 200, type: 'application/json', body: Buffer.from(PRESET) })
    expect(await make().stage({ source: 'Home', versionId: 'pv1', kind: 'preset' })).toMatchObject({ id: 'st-1', kind: 'preset' })
    expect(staged).toEqual([{ kind: 'preset', file: Buffer.from(PRESET), name: 'preset' }])
    expect(presets).toEqual([])
    await expect(make().stage({ source: 'Home', versionId: 'pv1', kind: 'lorebook' })).rejects.toMatchObject({ failure: 'invalid', message: 'that release is not a lorebook' })
  })

  it('refuses a release that is not a preset and a download that is not the published one', async () => {
    answers['http://localhost:9798/versions/pv1'] = () => json(version({ resourceType: 'sillytavern/character' }))
    await expect(make().convertPreset({ source: 'Home', versionId: 'pv1' })).rejects.toMatchObject({ failure: 'invalid', message: 'that release is not a preset' })
    answers['http://localhost:9798/versions/pv1'] = () => json(version({ artifactSha256: '00' }))
    answers['http://localhost:9798/versions/pv1/download'] = () => ({ status: 200, type: 'application/json', body: Buffer.from(PRESET) })
    await expect(make().convertPreset({ source: 'Home', versionId: 'pv1' })).rejects.toThrow(/does not match the checksum/)
    expect(presets).toEqual([])
  })

  it('lists the presets of a catalogue as their own kind', async () => {
    answers['http://localhost:9798/resources'] = () => json({ items: [{ ...item('p1', 'Noir'), resourceType: 'sillytavern/preset' }] })
    const page = await make().worlds('Home', { kind: 'preset' })
    expect(page.items[0]).toMatchObject({ kind: 'preset', name: 'Noir' })
    expect(calls.at(-1)?.url).toContain('resourceType=sillytavern%2Fpreset')
  })
})

describe('importing a SillyTavern lorebook', () => {
  const BOOK = JSON.stringify({ entries: { 0: { comment: 'Tides', content: 'Twice a day.' } } })
  const version = (extra: Record<string, unknown> = {}) => ({ id: 'bv1', resourceId: 'b1', resourceType: 'sillytavern/lorebook', version: '1', ...extra })

  it('downloads it with the catalogue\'s key and hands it to the library under the entry\'s title', async () => {
    answers['http://localhost:9798/versions/bv1'] = () => json(version({ artifactSha256: createHash('sha256').update(BOOK).digest('hex') }))
    answers['http://localhost:9798/versions/bv1/download'] = () => ({ status: 200, type: 'application/json', body: Buffer.from(BOOK) })
    expect(await make().convertLorebook({ source: 'Home', versionId: 'bv1', title: 'Harbor', language: 'en' })).toEqual({ name: 'imported-book', chatSessionId: 'chat-3', started: true })
    expect(lorebooks).toEqual([{ file: Buffer.from(BOOK), title: 'Harbor', language: 'en' }])
    expect(presets).toEqual([])
  })

  it('refuses a release that is not a lorebook, and lists the lorebooks of a catalogue as their own kind', async () => {
    answers['http://localhost:9798/versions/bv1'] = () => json(version({ resourceType: 'sillytavern/preset' }))
    await expect(make().convertLorebook({ source: 'Home', versionId: 'bv1' })).rejects.toMatchObject({ failure: 'invalid', message: 'that release is not a lorebook' })
    answers['http://localhost:9798/resources'] = () => json({ items: [{ ...item('b1', 'Harbor'), resourceType: 'sillytavern/lorebook' }] })
    const page = await make().worlds('Home', { kind: 'lorebook' })
    expect(page.items[0]).toMatchObject({ kind: 'lorebook', name: 'Harbor' })
    expect(calls.at(-1)?.url).toContain('resourceType=sillytavern%2Florebook')
  })})
