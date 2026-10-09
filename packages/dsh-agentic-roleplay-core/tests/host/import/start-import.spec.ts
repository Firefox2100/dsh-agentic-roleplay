import { mkdir, mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { readCard } from '../../../src/host/import/card.ts'
import { importPhase } from '../../../src/host/import/run-import.ts'
import { folderNameOf, importMessage, startImport } from '../../../src/host/import/start-import.ts'
import { ImportStore } from '../../../src/host/import/store.ts'
import type { RoleplayRoot } from '../../../src/host/storage/roleplay-root.ts'
import { InvalidEditProblems } from '../../../src/shared/world-state.ts'
import { WorldCatalog } from '../../../src/host/worlds/catalog.ts'
import { parseImportCommand } from '../../../src/shared/import-card.ts'
import { v3Card } from '../../support/cards.ts'

let root: { path: string }
let sent: [string, string][]
let sendError: Error | undefined
let created: [string, string, string][]
const card = () => readCard(Buffer.from(JSON.stringify(v3Card())), 'x.json')

const deps = (worlds: WorldCatalog, store: ImportStore) => ({
  store,
  worlds,
  authoring: {
    ensure: (id: string, name: string, title: string) => { created.push([id, name, title]); return Promise.resolve(`world-author-${id}`) },
    send: (chat: string, text: string) => { sent.push([chat, text]); return sendError === undefined ? Promise.resolve() : Promise.reject(sendError) },
  },
  chatTitle: (name: string) => `Authoring ${name}`,
})

beforeEach(async () => {
  root = { path: await mkdtemp(join(tmpdir(), 'start-import-')) }
  await mkdir(join(root.path, 'worlds'), { recursive: true })
  sent = []
  created = []
  sendError = undefined
})
afterEach(async () => { await rm(root.path, { recursive: true, force: true }) })

describe('the command that starts an import', () => {
  it('is read from a message with the card it names and what is asked of it', () => {
    expect(parseImportCommand(importMessage())).toEqual({ card: '.import/card.json', request: 'Import this card into this newly created world.' })
    expect(parseImportCommand('  /IMPORT-ST x')).toEqual({ card: 'x', request: '' })
    expect(parseImportCommand('/import-stx y')).toBeUndefined()
    expect(parseImportCommand('please /import-st')).toBeUndefined()
  })

  it('makes a folder name from a world name', () => {
    expect(folderNameOf('  The: Harbour / Light?  ')).toBe('The Harbour Light')
    expect(folderNameOf('港口灯塔')).toBe('港口灯塔')
    expect(folderNameOf('???')).toBe('imported world')
    expect(folderNameOf('a'.repeat(200)).length).toBe(90)
  })
})

describe('starting an import', () => {
  it('makes an empty world named as chosen, moves the card into it, opens its authoring chat and sends the command for the person', async () => {
    const worlds = new WorldCatalog(new Context(), root as RoleplayRoot)
    const store = new ImportStore(() => root.path)
    const made = await store.create(card(), Buffer.from('png'))
    const started = await startImport(deps(worlds, store), made.id, { name: 'My Harbour', disabledEntries: [], opening: { kind: 'first' } })
    expect(started).toMatchObject({ started: true, chatSessionId: `world-author-${started.worldId}` })
    expect(sent).toEqual([[started.chatSessionId, importMessage()]])
    expect(created).toEqual([[started.worldId, 'My Harbour', 'Authoring My Harbour']])
    const record = await worlds.find(started.worldId)
    expect(record?.folder).toBe('My Harbour')
    expect(await importPhase(record!.directory)).toBe('ready')
    expect((await readdir(join(record!.directory, '.import'))).sort()).toEqual(['card.json', 'choices.json', 'picture.png', 'state.json'])
    await expect(store.read(made.id)).rejects.toThrow()
  })

  it('takes another folder when the name is taken, and says the command was not sent when it could not be', async () => {
    const worlds = new WorldCatalog(new Context(), root as RoleplayRoot)
    const store = new ImportStore(() => root.path)
    const first = await startImport(deps(worlds, store), (await store.create(card())).id, { name: 'Same', disabledEntries: [], opening: { kind: 'none' } })
    sendError = new Error('agent is not loaded')
    const second = await startImport(deps(worlds, store), (await store.create(card())).id, { name: 'Same', disabledEntries: [], opening: { kind: 'none' } })
    expect((await worlds.find(first.worldId))?.folder).toBe('Same')
    expect((await worlds.find(second.worldId))?.folder).toBe('Same 2')
    expect(second.started).toBe(false)
  })

  it('refuses choices that cannot be used before anything is made', async () => {
    const worlds = new WorldCatalog(new Context(), root as RoleplayRoot)
    const store = new ImportStore(() => root.path)
    const made = await store.create(card())
    await expect(startImport(deps(worlds, store), made.id, { name: ' ', disabledEntries: [], opening: { kind: 'first' } })).rejects.toThrow(InvalidEditProblems)
    expect(await readdir(join(root.path, 'worlds'))).toEqual([])
    expect(sent).toEqual([])
  })
})
