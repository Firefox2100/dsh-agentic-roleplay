import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { authoringChatSessionId } from '../../../src/shared/authoring-chat.ts'
import { InvalidEditProblems } from '../../../src/shared/world-state.ts'
import { readCard } from '../../../src/host/import/card.ts'
import { cardPieces } from '../../../src/host/import/card-tools.ts'
import { endReview, importPhase } from '../../../src/host/import/run-import.ts'
import { editsSince, writeSnapshot } from '../../../src/host/import/snapshot.ts'
import { startImport } from '../../../src/host/import/start-import.ts'
import { ImportStore } from '../../../src/host/import/store.ts'
import { updateHooks, updateTools } from '../../../src/host/import/update-tools.ts'
import { canRevert, findTargets, finishUpdate, revertUpdate, startUpdate, updateMessage, updateStatus } from '../../../src/host/import/update.ts'
import type { RoleplayRoot } from '../../../src/host/storage/roleplay-root.ts'
import { WorldCatalog } from '../../../src/host/worlds/catalog.ts'
import { readImageFileMetadata, writeImageFileMetadata } from '../../../src/host/images/image-files.ts'
import { referenceImagePath } from '../../../src/host/images/storage.ts'
import { v3Card } from '../../support/cards.ts'

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64')
const OTHER_PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64')
let root: { path: string }
let sent: [string, string][]
const choices = { name: 'Test Harbour', disabledEntries: [], opening: { kind: 'first' as const } }
const card = (data: Record<string, unknown> = {}) => readCard(Buffer.from(JSON.stringify(v3Card(data))), 'x.json')
const entry = (id: number, comment: string, content: string) => ({ id, keys: [comment], comment, content, enabled: true, constant: false, selective: false, position: 'before_char', insertion_order: 100 })
const newer = () => card({ description: 'A fishing town where a lighthouse keeper keeps a ledger and a ferry runs at dawn.', character_book: { name: 'Harbour book', entries: [entry(0, 'Old Tam', 'Old Tam keeps the lighthouse.'), entry(1, 'The ferry', 'The ferry runs at dawn.')] } })

const exec = (id: string) => ({ agent: { session: { id: authoringChatSessionId(id) } }, signal: new AbortController().signal }) as never
const run = async (worlds: WorldCatalog, id: string, name: string, args: Record<string, unknown> = {}) => await updateTools(worlds).find(tool => tool.name === name)!.execute(args as never, exec(id)) as never as Record<string, any>

const deps = (worlds: WorldCatalog, store: ImportStore) => ({
  store,
  worlds,
  authoring: {
    ensure: (id: string) => Promise.resolve(authoringChatSessionId(id)),
    send: (chat: string, text: string) => { sent.push([chat, text]); return Promise.resolve() },
  },
})

/** A world made by an import that is over: the card, its records and a snapshot of the files. */
async function importedWorld(worlds: WorldCatalog, store: ImportStore): Promise<{ id: string; directory: string }> {
  const started = await startImport(deps(worlds, store), (await store.create(card())).id, choices)
  const record = (await worlds.find(started.worldId))!
  await writeFile(join(record.directory, '.import', 'state.json'), JSON.stringify({ phase: 'done' }))
  await writeFile(join(record.directory, '.import', 'classification.json'), JSON.stringify({ 'field:description': { roles: ['place'], targets: [] }, 'entry:0': { roles: ['character'], targets: [] } }))
  await mkdir(join(record.directory, 'characters', 'tam'), { recursive: true })
  await writeFile(join(record.directory, 'characters', 'tam', 'character.json'), '{"id":"tam"}')
  await writeSnapshot(record.directory)
  sent = []
  return { id: record.summary.id, directory: record.directory }
}

beforeEach(async () => {
  root = { path: await mkdtemp(join(tmpdir(), 'card-update-')) }
  await mkdir(join(root.path, 'worlds'), { recursive: true })
  sent = []
})
afterEach(async () => { await rm(root.path, { recursive: true, force: true }) })

describe('the worlds a card can update', () => {
  it('are the finished imports with the card\'s name, and say whether anyone changed them since', async () => {
    const worlds = new WorldCatalog(new Context(), root as RoleplayRoot)
    const store = new ImportStore(() => root.path)
    const world = await importedWorld(worlds, store)
    expect(await findTargets(worlds, '  test harbour ')).toEqual([{ worldId: world.id, name: 'Test Harbour', sameName: true, edited: 'no', changes: [] }])
    await writeFile(join(world.directory, 'characters', 'tam', 'character.json'), '{"id":"tam","name":"Tam"}')
    expect(await findTargets(worlds, 'Test Harbour')).toEqual([{ worldId: world.id, name: 'Test Harbour', sameName: true, edited: 'yes', changes: ['changed: characters/tam/character.json'] }])
    expect(await findTargets(worlds, 'Another name')).toEqual([{ worldId: world.id, name: 'Test Harbour', sameName: false, edited: 'yes', changes: ['changed: characters/tam/character.json'] }])
  })

  it('list the worlds of the same name first, then every other world made from a card', async () => {
    const worlds = new WorldCatalog(new Context(), root as RoleplayRoot)
    const store = new ImportStore(() => root.path)
    const first = await importedWorld(worlds, store)
    const started = await startImport(deps(worlds, store), (await store.create(card())).id, { ...choices, name: 'Another harbour' })
    const second = (await worlds.find(started.worldId))!
    await writeFile(join(second.directory, '.import', 'state.json'), JSON.stringify({ phase: 'done' }))
    expect((await findTargets(worlds, 'another HARBOUR')).map(target => [target.name, target.sameName])).toEqual([['Another harbour', true], ['Test Harbour', false]])
    expect((await findTargets(worlds, 'Test Harbour')).map(target => [target.worldId === first.id, target.sameName])).toEqual([[true, true], [false, false]])
  })

  it('are not worlds that were not made from a card, or whose import is not over; a world imported before snapshots cannot be judged', async () => {
    const worlds = new WorldCatalog(new Context(), root as RoleplayRoot)
    const store = new ImportStore(() => root.path)
    const started = await startImport(deps(worlds, store), (await store.create(card())).id, choices)
    const record = (await worlds.find(started.worldId))!
    expect(await importPhase(record.directory)).toBe('ready')
    expect(await findTargets(worlds, 'Test Harbour')).toEqual([])
    await writeFile(join(record.directory, '.import', 'state.json'), JSON.stringify({ phase: 'done' }))
    expect(await findTargets(worlds, 'Test Harbour')).toEqual([{ worldId: started.worldId, name: 'Test Harbour', sameName: true, edited: 'unknown', changes: [] }])
    await rm(join(record.directory, '.import'), { recursive: true })
    expect(await findTargets(worlds, 'Test Harbour')).toEqual([])
    expect(await editsSince(record.directory)).toEqual({ edited: 'unknown' })
  })

  it('do not count the pictures of a world as a change', async () => {
    const worlds = new WorldCatalog(new Context(), root as RoleplayRoot)
    const world = await importedWorld(worlds, new ImportStore(() => root.path))
    await mkdir(join(world.directory, 'images', 'library'), { recursive: true })
    await writeFile(join(world.directory, 'images', 'library', 'x.png'), 'png')
    expect(await editsSince(world.directory)).toEqual({ edited: 'no' })
  })
})

describe('the snapshot of a world', () => {
  it('is taken when the import turn that corrected the world is over', async () => {
    const worlds = new WorldCatalog(new Context(), root as RoleplayRoot)
    const store = new ImportStore(() => root.path)
    const started = await startImport(deps(worlds, store), (await store.create(card())).id, choices)
    const record = (await worlds.find(started.worldId))!
    await writeFile(join(record.directory, '.import', 'state.json'), JSON.stringify({ phase: 'done', reviewing: true }))
    await writeFile(join(record.directory, 'notes.txt'), 'review edit')
    await endReview(record.directory)
    expect(await editsSince(record.directory)).toEqual({ edited: 'no' })
    await writeFile(join(record.directory, 'notes.txt'), 'later edit')
    expect(await editsSince(record.directory)).toEqual({ edited: 'yes', changes: ['changed: notes.txt'] })
    await endReview(record.directory)
    expect(await editsSince(record.directory)).toMatchObject({ edited: 'yes' })
  })
})

describe('starting an update', () => {
  it('keeps the old card, puts the new one beside it, opens the chat and sends the message', async () => {
    const worlds = new WorldCatalog(new Context(), root as RoleplayRoot)
    const store = new ImportStore(() => root.path)
    const world = await importedWorld(worlds, store)
    const upload = await store.create(newer())
    const started = await startUpdate(deps(worlds, store), upload.id, { ...choices, name: 'Renamed in the dialog' }, world.id)
    expect(started).toMatchObject({ worldId: world.id, started: true, chatSessionId: authoringChatSessionId(world.id) })
    expect(sent).toEqual([[started.chatSessionId, updateMessage()]])
    expect((await readdir(join(world.directory, '.import', 'update'))).sort()).toEqual(['card.json', 'choices.json'])
    expect(JSON.parse(await readFile(join(world.directory, '.import', 'update', 'choices.json'), 'utf8')).name).toBe('Test Harbour')
    expect(JSON.parse(await readFile(join(world.directory, '.import', 'card.json'), 'utf8')).description).toContain('lighthouse keeper')
    expect(JSON.parse(await readFile(join(world.directory, '.import', 'card.json'), 'utf8')).description).not.toContain('ferry runs')
    await expect(store.read(upload.id)).rejects.toThrow()
  })

  it('refuses a world that was not made from a card, and a world that is gone', async () => {
    const worlds = new WorldCatalog(new Context(), root as RoleplayRoot)
    const store = new ImportStore(() => root.path)
    const upload = await store.create(newer())
    await expect(startUpdate(deps(worlds, store), upload.id, choices, 'nowhere')).rejects.toThrow(/no world/)
    const world = await importedWorld(worlds, store)
    await rm(join(world.directory, '.import'), { recursive: true })
    await expect(startUpdate(deps(worlds, store), upload.id, choices, world.id)).rejects.toThrow(InvalidEditProblems)
    expect(sent).toEqual([])
  })

  it('speaks the language of the person', () => {
    expect(updateMessage('zh')).toContain('card_diff')
    expect(updateMessage('zh')).toContain('新版本')
    expect(updateMessage('fr')).toBe(updateMessage())
  })
})

describe('the tools of an update', () => {
  it('card_diff says what changed, what was made of it, and what was edited since', async () => {
    const worlds = new WorldCatalog(new Context(), root as RoleplayRoot)
    const store = new ImportStore(() => root.path)
    const world = await importedWorld(worlds, store)
    await writeFile(join(world.directory, 'characters', 'tam', 'character.json'), '{"id":"tam","name":"Tam"}')
    await expect(run(worlds, world.id, 'card_diff')).rejects.toThrow(/no newer version/)
    await startUpdate(deps(worlds, store), (await store.create(newer())).id, choices, world.id)
    const diff = await run(worlds, world.id, 'card_diff')
    expect(diff['changed']).toHaveLength(1)
    expect(diff['changed'][0]).toMatchObject({ piece: 'field:description' })
    expect(diff['changed'][0]['differences'][0]).toMatchObject({ added: expect.stringContaining('ferry runs at dawn') })
    expect(diff['added']).toMatchObject([{ piece: 'entry:1', label: expect.stringContaining('The ferry') }])
    expect(diff['dropped']).toEqual([])
    expect(diff['unchanged']).toBe(cardPieces(card(), choices).length - 1)
    expect(diff['editedSinceTheImport']).toEqual(['changed: characters/tam/character.json'])
  })

  it('card_diff names what only a dropped piece made, and what the card changed about the world itself', async () => {
    const worlds = new WorldCatalog(new Context(), root as RoleplayRoot)
    const store = new ImportStore(() => root.path)
    const world = await importedWorld(worlds, store)
    await writeFile(join(world.directory, '.import', 'classification.json'), JSON.stringify({ 'field:description': { roles: ['place'], targets: [{ name: 'The Lighthouse', kind: 'place' }] }, 'entry:0': { roles: ['character'], targets: [{ name: 'Old Tam', kind: 'character' }] } }))
    await writeFile(join(world.directory, '.import', 'roster.json'), JSON.stringify([{ kind: 'character', key: 'tam', name: 'Old Tam', aliases: [], player: false }, { kind: 'place', key: 'light', name: 'The Lighthouse', aliases: [], player: false }]))
    await mkdir(join(world.directory, 'lore', 'tam-notes'), { recursive: true })
    await writeFile(join(world.directory, 'lore', 'tam-notes', 'lore.json'), JSON.stringify({ id: 'tam-notes', title: ' old TAM ', summary: 's' }))
    const without = card({ description: 'A fishing town where a lighthouse keeper keeps a ledger.', first_mes: 'Gulls cry over the pier.', tags: ['harbour', 'storm'], character_book: { name: 'Harbour book', entries: [] } })
    await startUpdate(deps(worlds, store), (await store.create(without)).id, choices, world.id)
    const diff = await run(worlds, world.id, 'card_diff')
    expect(diff['dropped']).toEqual([expect.objectContaining({ piece: 'entry:0', version: 'current', madeInto: ['Old Tam', 'The Lighthouse'], madeOnlyFromIt: ['Old Tam'], loreWithTheSameTitle: ['tam-notes'] })])
    expect(diff['aboutTheWorld']).toEqual([expect.objectContaining({ field: 'tags' }), expect.objectContaining({ field: 'opening' })])
    expect(diff['note']).toContain('edit_world_info')
    expect(diff['note']).toContain('delete_world_element')
  })

  it('card_update_finish makes the newer card the source, follows the records, and measures later edits from here', async () => {
    const worlds = new WorldCatalog(new Context(), root as RoleplayRoot)
    const store = new ImportStore(() => root.path)
    const world = await importedWorld(worlds, store)
    await startUpdate(deps(worlds, store), (await store.create(newer())).id, choices, world.id)
    await writeFile(join(world.directory, 'characters', 'tam', 'character.json'), '{"id":"tam","name":"Tam"}')
    const done = await run(worlds, world.id, 'card_update_finish')
    expect(done).toMatchObject({ done: true, forgottenRecords: 0, worldInfoToCheck: [expect.stringContaining('description:')], portrait: 'none' })
    expect(JSON.parse(await readFile(join(world.directory, '.import', 'card.json'), 'utf8')).description).toContain('ferry runs at dawn')
    expect(JSON.parse(await readFile(join(world.directory, '.import', 'previous', 'card.json'), 'utf8')).description).not.toContain('ferry runs')
    await expect(readdir(join(world.directory, '.import', 'update'))).rejects.toThrow()
    expect(await editsSince(world.directory)).toEqual({ edited: 'no' })
    await expect(run(worlds, world.id, 'card_update_finish')).rejects.toThrow(/no newer version/)
    const overview = await run(worlds, world.id, 'card_diff').catch((error: Error) => error.message)
    expect(overview).toMatch(/no newer version/)
  })

  it('finishing carries the records to the pieces that moved and forgets those the card dropped', async () => {
    const worlds = new WorldCatalog(new Context(), root as RoleplayRoot)
    const store = new ImportStore(() => root.path)
    const world = await importedWorld(worlds, store)
    const reordered = card({ description: 'A fishing town where a lighthouse keeper keeps a ledger.', character_book: { name: 'Harbour book', entries: [entry(0, 'The ferry', 'The ferry runs at dawn.'), entry(1, 'Old Tam', 'Old Tam keeps the lighthouse.')] } })
    await startUpdate(deps(worlds, store), (await store.create(reordered)).id, choices, world.id)
    await finishUpdate(world.directory)
    const records = JSON.parse(await readFile(join(world.directory, '.import', 'classification.json'), 'utf8')) as Record<string, unknown>
    expect(Object.keys(records).sort()).toEqual(['entry:1', 'field:description'])

    const without = card({ description: 'A fishing town where a lighthouse keeper keeps a ledger.', character_book: { name: 'Harbour book', entries: [] } })
    await startUpdate(deps(worlds, store), (await store.create(without)).id, choices, world.id)
    const outcome = await finishUpdate(world.directory)
    expect(outcome.forgotten).toBe(1)
    expect(Object.keys(JSON.parse(await readFile(join(world.directory, '.import', 'classification.json'), 'utf8')))).toEqual(['field:description'])
  })

  it('finishing fetches only the pictures the newer card adds', async () => {
    const worlds = new WorldCatalog(new Context(), root as RoleplayRoot)
    const store = new ImportStore(() => root.path)
    const world = await importedWorld(worlds, store)
    const fresh = card({ description: 'See https://example.test/new.png for the quay.' })
    await startUpdate(deps(worlds, store), (await store.create(fresh)).id, choices, world.id)
    const asked: string[][] = []
    const outcome = await finishUpdate(world.directory, { fetcher: async (_world, urls) => { asked.push([...urls]); return { found: urls.length, added: [{ url: urls[0]!, path: 'images/library/new.png' }], skipped: [] } } })
    expect(asked).toEqual([['https://example.test/new.png']])
    expect(outcome.pictures).toEqual({ found: 1, added: 1, droppedFromTheCard: [] })
  })

  it('does not call a picture dropped when the card now points to it at another address', async () => {
    const worlds = new WorldCatalog(new Context(), root as RoleplayRoot)
    const store = new ImportStore(() => root.path)
    const started = await startImport(deps(worlds, store), (await store.create(card({ description: 'See https://example.test/old.png.' }))).id, choices)
    const world = (await worlds.find(started.worldId))!
    await writeFile(join(world.directory, '.import', 'state.json'), JSON.stringify({ phase: 'done' }))
    await writeSnapshot(world.directory)
    await mkdir(join(world.directory, 'images', 'library'), { recursive: true })
    await writeFile(join(world.directory, 'images', 'library', 'old.png'), PNG)
    await writeFile(join(world.directory, '.import', 'pictures.json'), JSON.stringify({ found: 1, added: [{ url: 'https://example.test/old.png', path: 'library/old.png' }], skipped: [] }))
    await startUpdate(deps(worlds, store), (await store.create(card({ description: 'See https://mirror.test/same.png.' }))).id, choices, started.worldId)
    const outcome = await finishUpdate(world.directory, { fetcher: async (_world, urls) => ({ found: urls.length, added: [], skipped: [{ url: urls[0]!, reason: 'a copy of another picture', of: 'library/old.png' }] }) })
    expect(outcome.pictures).toEqual({ found: 1, added: 0, droppedFromTheCard: [] })
  })

  it('asks again for a picture that failed before, records the answer, and lists fetched pictures the card dropped', async () => {
    const worlds = new WorldCatalog(new Context(), root as RoleplayRoot)
    const store = new ImportStore(() => root.path)
    const first = card({ description: 'See https://example.test/down.png and https://example.test/old.png and https://example.test/page.' })
    const started = await startImport(deps(worlds, store), (await store.create(first)).id, choices)
    const world = (await worlds.find(started.worldId))!
    await writeFile(join(world.directory, '.import', 'state.json'), JSON.stringify({ phase: 'done' }))
    await writeSnapshot(world.directory)
    await mkdir(join(world.directory, 'images', 'library'), { recursive: true })
    await writeFile(join(world.directory, 'images', 'library', 'old.png'), PNG)
    const recorded = { found: 3, added: [{ url: 'https://example.test/old.png', path: 'library/old.png' }], skipped: [{ url: 'https://example.test/down.png', reason: 'timed out' }, { url: 'https://example.test/page', reason: 'not an image (text/html)' }] }
    await writeFile(join(world.directory, '.import', 'pictures.json'), JSON.stringify(recorded))
    const later = card({ description: 'See https://example.test/down.png and https://example.test/page and https://example.test/fresh.png.' })
    await startUpdate(deps(worlds, store), (await store.create(later)).id, choices, started.worldId)
    const asked: string[][] = []
    const outcome = await finishUpdate(world.directory, { fetcher: async (_world, urls) => { asked.push([...urls]); return { found: urls.length, added: urls.map(url => ({ url, path: `library/${url.split('/').pop()}` })), skipped: [] } } })
    expect(asked).toEqual([['https://example.test/down.png', 'https://example.test/fresh.png']])
    expect(outcome.pictures).toEqual({ found: 2, added: 2, droppedFromTheCard: ['library/old.png'] })
    const saved = JSON.parse(await readFile(join(world.directory, '.import', 'pictures.json'), 'utf8'))
    expect(saved.added.map((entry: { url: string }) => entry.url)).toEqual(['https://example.test/old.png', 'https://example.test/down.png', 'https://example.test/fresh.png'])
    expect(saved.skipped).toEqual([{ url: 'https://example.test/page', reason: 'not an image (text/html)' }])
  })
})

describe('undoing an update', () => {
  it('keeps the world as it was before the update, and puts it back, with what it held kept in the trash', async () => {
    const worlds = new WorldCatalog(new Context(), root as RoleplayRoot)
    const store = new ImportStore(() => root.path)
    const world = await importedWorld(worlds, store)
    expect(await updateStatus(world.directory)).toEqual({ fromCard: true, revertible: false, waiting: false })
    await startUpdate(deps(worlds, store), (await store.create(newer())).id, choices, world.id)
    expect(await updateStatus(world.directory)).toEqual({ fromCard: true, revertible: true, waiting: true })
    await writeFile(join(world.directory, 'characters', 'tam', 'character.json'), '{"id":"tam","name":"Tam"}')
    await mkdir(join(world.directory, 'characters', 'wren'), { recursive: true })
    await writeFile(join(world.directory, 'characters', 'wren', 'character.json'), '{"id":"wren"}')
    await finishUpdate(world.directory)
    const { keptIn } = await revertUpdate(world.directory)
    expect(await readFile(join(world.directory, 'characters', 'tam', 'character.json'), 'utf8')).toBe('{"id":"tam"}')
    await expect(readdir(join(world.directory, 'characters', 'wren'))).rejects.toThrow()
    expect(await readFile(join(keptIn, 'characters', 'tam', 'character.json'), 'utf8')).toBe('{"id":"tam","name":"Tam"}')
    expect(JSON.parse(await readFile(join(world.directory, '.import', 'card.json'), 'utf8')).description).not.toContain('ferry runs')
    expect(await readdir(join(world.directory, '.import'))).not.toContain('previous')
    expect(await readdir(join(world.directory, '.import'))).not.toContain('update')
    expect(await editsSince(world.directory)).toEqual({ edited: 'no' })
    expect(await canRevert(world.directory)).toBe(false)
    await expect(revertUpdate(world.directory)).rejects.toThrow(InvalidEditProblems)
  })

  it('goes back to the state before the first of two updates that were started without finishing the first', async () => {
    const worlds = new WorldCatalog(new Context(), root as RoleplayRoot)
    const store = new ImportStore(() => root.path)
    const world = await importedWorld(worlds, store)
    await startUpdate(deps(worlds, store), (await store.create(newer())).id, choices, world.id)
    await writeFile(join(world.directory, 'characters', 'tam', 'character.json'), '{"id":"tam","name":"half done"}')
    await startUpdate(deps(worlds, store), (await store.create(newer())).id, choices, world.id)
    await revertUpdate(world.directory)
    expect(await readFile(join(world.directory, 'characters', 'tam', 'character.json'), 'utf8')).toBe('{"id":"tam"}')
  })

  it('does not touch the pictures of the world', async () => {
    const worlds = new WorldCatalog(new Context(), root as RoleplayRoot)
    const store = new ImportStore(() => root.path)
    const world = await importedWorld(worlds, store)
    await startUpdate(deps(worlds, store), (await store.create(newer())).id, choices, world.id)
    await mkdir(join(world.directory, 'images', 'library'), { recursive: true })
    await writeFile(join(world.directory, 'images', 'library', 'new.png'), 'png')
    await revertUpdate(world.directory)
    expect(await readFile(join(world.directory, 'images', 'library', 'new.png'), 'utf8')).toBe('png')
  })
})

describe('the portrait that came with the card', () => {
  async function withPortrait(worlds: WorldCatalog, store: ImportStore, origin: 'uploaded' | 'generated'): Promise<{ id: string; directory: string; file: string }> {
    const world = await importedWorld(worlds, store)
    await writeFile(join(world.directory, 'characters', 'tam', 'character.json'), JSON.stringify({ id: 'tam', name: 'Test Harbour' }))
    await writeFile(join(world.directory, '.import', 'picture.png'), PNG)
    const file = referenceImagePath(world.directory, { kind: 'character', localId: 'tam' })
    await mkdir(join(file, '..'), { recursive: true })
    await writeFile(file, PNG)
    await writeImageFileMetadata(file, { schema: 'dsh-roleplay-image/v3', purpose: 'reference', origin, ...(origin === 'uploaded' ? { originalName: 'picture.png' } : {}), createdAt: 'then', subjects: [{ kind: 'character', localId: 'tam', name: 'Test Harbour' }] })
    return { ...world, file }
  }

  it('is replaced by the new card\'s picture when it still is the card\'s', async () => {
    const worlds = new WorldCatalog(new Context(), root as RoleplayRoot)
    const store = new ImportStore(() => root.path)
    const world = await withPortrait(worlds, store, 'uploaded')
    await startUpdate(deps(worlds, store), (await store.create(newer(), OTHER_PNG)).id, choices, world.id)
    expect(await run(worlds, world.id, 'card_update_finish')).toMatchObject({ portrait: 'replaced' })
    expect(await readImageFileMetadata(world.file)).toMatchObject({ origin: 'uploaded', originalName: 'picture.png', subjects: [{ localId: 'tam' }] })
    expect((await readFile(world.file)).equals(PNG)).toBe(false)
    expect((await readFile(join(world.directory, '.import', 'picture.png'))).equals(OTHER_PNG)).toBe(true)
  })

  it('is kept when the person put another picture in its place, or the card\'s picture did not change', async () => {
    const worlds = new WorldCatalog(new Context(), root as RoleplayRoot)
    const store = new ImportStore(() => root.path)
    const own = await withPortrait(worlds, store, 'generated')
    const before = await readFile(own.file)
    await startUpdate(deps(worlds, store), (await store.create(newer(), OTHER_PNG)).id, choices, own.id)
    expect(await run(worlds, own.id, 'card_update_finish')).toMatchObject({ portrait: 'kept' })
    expect((await readFile(own.file)).equals(before)).toBe(true)
    await startUpdate(deps(worlds, store), (await store.create(newer(), OTHER_PNG)).id, choices, own.id)
    expect(await run(worlds, own.id, 'card_update_finish')).toMatchObject({ portrait: 'kept' })
  })
})

describe('the turn of an update', () => {
  function hooked(worlds: WorldCatalog) {
    const listeners: Record<string, (...args: never[]) => unknown> = {}
    updateHooks({ on: (name: string, listener: (...args: never[]) => unknown) => { listeners[name] = listener } } as never, worlds, () => 'en')
    const agent = (id: string, origin?: 'subagent') => ({ session: { id, header: { ...(origin === undefined ? {} : { origin }) } }, steer: vi.fn() })
    const step = (agent: unknown, text: string, turn = 1) => (listeners['agent/pre-step'] as (payload: unknown, next: () => Promise<unknown>) => Promise<unknown>)(
      { agent, step: 1, turn, messages: [{ source: { kind: 'user' }, content: [{ type: 'text', text }] }] }, () => Promise.resolve({ kind: 'enter', messages: [] }))
    const stopping = (agent: unknown, turn = 1) => (listeners['agent/turn-stopping'] as (payload: unknown) => Promise<void>)({ agent, turn })
    return { agent, step, stopping }
  }

  it('is sent back once when it stops before the update is finished, and then let go so that a question can end it', async () => {
    const worlds = new WorldCatalog(new Context(), root as RoleplayRoot)
    const store = new ImportStore(() => root.path)
    const world = await importedWorld(worlds, store)
    await startUpdate(deps(worlds, store), (await store.create(newer())).id, choices, world.id)
    const { agent, step, stopping } = hooked(worlds)
    const chat = agent(authoringChatSessionId(world.id))
    await step(chat, updateMessage())
    await stopping(chat)
    expect(chat.steer).toHaveBeenCalledTimes(1)
    await stopping(chat)
    expect(chat.steer).toHaveBeenCalledTimes(1)
  })

  it('is let end once the update is finished, and ordinary turns, other chats and children are left alone', async () => {
    const worlds = new WorldCatalog(new Context(), root as RoleplayRoot)
    const store = new ImportStore(() => root.path)
    const world = await importedWorld(worlds, store)
    await startUpdate(deps(worlds, store), (await store.create(newer())).id, choices, world.id)
    const { agent, step, stopping } = hooked(worlds)
    const chat = agent(authoringChatSessionId(world.id))
    await step(chat, updateMessage())
    await finishUpdate(world.directory)
    await stopping(chat)
    expect(chat.steer).not.toHaveBeenCalled()
    await startUpdate(deps(worlds, store), (await store.create(newer())).id, choices, world.id)
    const other = agent(authoringChatSessionId(world.id))
    await step(other, 'Add a tavern.')
    await stopping(other)
    await step(agent('session-abc'), updateMessage())
    await stopping(agent('session-abc'))
    await step(agent(authoringChatSessionId(world.id), 'subagent'), updateMessage())
    expect(other.steer).not.toHaveBeenCalled()
  })
})
