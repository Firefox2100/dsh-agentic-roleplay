import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ImportStaging } from '../../../src/host/import/staging.ts'
import { Lorebooks } from '../../../src/host/lorebooks/service.ts'
import { lorebookDirectory } from '../../../src/host/lorebooks/lorebooks.ts'
import { LOREBOOK_UPLOAD } from '../../../src/host/authoring/lorebook-author-tools.ts'

let root: string
beforeEach(async () => { root = await mkdtemp(join(tmpdir(), 'rp-lorebook-staged-')) })
afterEach(async () => { await rm(root, { recursive: true, force: true }) })

const BOOK = Buffer.from(JSON.stringify({ name: 'Harbor Notes', entries: [{ comment: 'One', content: 'Fact one.' }, { comment: 'Two', content: 'Fact two.', disable: true }, { comment: 'Three', content: 'Fact three.' }] }))

describe('importing a staged lorebook', () => {
  it('keeps only the entries the person chose in the new library entry, under the name they gave or one made from the title', async () => {
    const staging = new ImportStaging()
    const sent: string[] = []
    const books = new Lorebooks({ root: () => root, authoring: { ensure: (name: string) => Promise.resolve(`chat-${name}`), send: (chat: string, text: string) => { sent.push(`${chat}: ${text}`); return Promise.resolve() } }, importMessage: () => 'go', maxUploadBytes: 1000, staging, session: () => { throw new Error('no story') }, playing: () => false })
    const first = staging.stage('lorebook', BOOK, 'harbor.json')
    expect(first.items.map(item => [item.title, item.enabled])).toEqual([['One', true], ['Two', false], ['Three', true]])
    const named = await books.importStaged({ id: first.id, enabled: ['1', '2'], sampling: true, name: 'harbor', language: 'en' })
    expect(named).toMatchObject({ name: 'harbor', started: true })
    expect(sent).toEqual(['chat-harbor: go'])
    const kept = JSON.parse(await readFile(join(lorebookDirectory(root, 'harbor'), LOREBOOK_UPLOAD), 'utf8')) as { entries: { comment: string; disable: boolean }[] }
    expect(kept.entries.map(entry => [entry.comment, entry.disable])).toEqual([['Two', false], ['Three', false]])
    const second = staging.stage('lorebook', BOOK, 'harbor.json')
    expect(await books.importStaged({ id: second.id, enabled: ['0'], sampling: true, title: 'Harbor Notes' })).toMatchObject({ name: 'Harbor-Notes' })
    await expect(books.importStaged({ id: second.id, enabled: ['0'], sampling: true })).rejects.toThrow('upload it again')
  })

  it('imports the chosen entries as they are, with no assistant, told to the game master only unless said otherwise', async () => {
    const staging = new ImportStaging()
    const sent: string[] = []
    const books = new Lorebooks({ root: () => root, authoring: { ensure: () => Promise.resolve('chat'), send: (_chat: string, text: string) => { sent.push(text); return Promise.resolve() } }, importMessage: () => 'go', maxUploadBytes: 1000, staging, session: () => { throw new Error('no story') }, playing: () => false })
    const first = staging.stage('lorebook', BOOK, 'harbor.json')
    expect(await books.importVerbatim({ id: first.id, enabled: ['0', '2'], sampling: true, knownBy: 'master' })).toEqual({ name: 'Harbor-Notes', entries: 2 })
    expect(sent).toEqual([])
    const made = await books.read('Harbor-Notes')
    expect(made.summary.title).toBe('Harbor Notes')
    expect(made.entries.map(entry => [entry.title, entry.body, entry.scope, entry.knownBy])).toEqual([['One', 'Fact one.', 'listed', []], ['Three', 'Fact three.', 'listed', []]])
    const second = staging.stage('lorebook', BOOK, 'harbor.json')
    await books.importVerbatim({ id: second.id, enabled: ['0'], sampling: true, knownBy: 'everyone', name: 'open' })
    expect((await books.read('open')).entries[0]).toMatchObject({ scope: 'everyone' })
    await expect(books.importVerbatim({ id: second.id, enabled: ['0'], sampling: true, knownBy: 'everyone' })).rejects.toThrow('upload it again')
    const third = staging.stage('lorebook', BOOK, 'harbor.json')
    await expect(books.importVerbatim({ id: third.id, enabled: ['0'], sampling: true, knownBy: 'everyone', name: 'open' })).rejects.toThrow('already a lorebook')
  })
})
