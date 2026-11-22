import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { galleryFile, listGallery, pageOf } from '../../../src/host/images/gallery.ts'
import { addCardLink } from '../../../src/host/images/gallery.ts'
import { addToLibraryOnce } from '../../../src/host/images/library.ts'
import { withPngMetadata } from '../../../src/host/images/png-metadata.ts'

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64')

let folder: string
beforeEach(async () => { folder = await mkdtemp(join(tmpdir(), 'gallery-')) })
afterEach(async () => { await rm(folder, { recursive: true, force: true }) })

async function put(path: string, metadata?: unknown): Promise<void> {
  await mkdir(join(folder, 'images', ...path.split('/').slice(0, -1)), { recursive: true })
  await writeFile(join(folder, 'images', ...path.split('/')), metadata === undefined ? PNG : withPngMetadata(PNG, metadata))
}

describe('the gallery of a session', () => {
  it('lists every image with what its file says, newest first, and reads an old image without a description', async () => {
    await put('characters/3/reference.png', { schema: 'dsh-roleplay-image/v2', purpose: 'reference', createdAt: '2026-01-01T00:00:00.000Z', prompt: 'P1', description: 'Mira: black hair.', tags: ['Mira'], provider: 'test', model: 'm', subjects: [{ kind: 'character', localId: 3, name: 'Mira' }] })
    await put('scenes/turn-n2-01.png', { schema: 'dsh-roleplay-image/v1', purpose: 'transient', createdAt: '2026-02-01T00:00:00.000Z', prompt: 'P2', revisedPrompt: 'R2', provider: 'test', model: 'm', subjects: [], source: { turn: 2, timelineNode: 'n2' } })
    const images = await listGallery(folder)
    expect(images.map(image => image.path)).toEqual(['scenes/turn-n2-01.png', 'characters/3/reference.png'])
    expect(images[0]).toMatchObject({ purpose: 'transient', prompt: 'P2', revisedPrompt: 'R2', tags: [], source: { turn: 2, timelineNode: 'n2' } })
    expect(images[0]!.description).toBeUndefined()
    expect(images[1]).toMatchObject({ purpose: 'reference', description: 'Mira: black hair.', tags: ['Mira'], subjects: [{ kind: 'character', name: 'Mira' }] })
  })

  it('lists an image whose metadata is gone, by its place, and nothing when there are no images', async () => {
    expect(await listGallery(folder)).toEqual([])
    await put('scenes/turn-n9-01.png')
    expect(await listGallery(folder)).toMatchObject([{ path: 'scenes/turn-n9-01.png', purpose: 'transient', unreadable: true }])
  })

  it('serves only PNG files inside the images, not reached through a link', async () => {
    await put('scenes/turn-n1-01.png')
    expect((await galleryFile(folder, 'scenes/turn-n1-01.png')).size).toBe(PNG.length)
    await writeFile(join(folder, 'secret.png'), PNG)
    await symlink(join(folder, 'secret.png'), join(folder, 'images', 'scenes', 'link.png'))
    for (const bad of ['../secret.png', 'scenes/../../secret.png', 'scenes/link.png', 'scenes/missing.png', 'scenes/turn-n1-01.txt', '', '/etc/passwd.png']) {
      await expect(galleryFile(folder, bad)).rejects.toThrow('no such image')
    }
  })

  it('keeps every address a picture came from, and gathers the pieces of a card under the address they belong to', async () => {
    const { path } = await addToLibraryOnce(folder, PNG, 'mara.png', undefined, { url: 'https://a.example/mara.png', pieces: ['entry:1'] })

    await addCardLink(folder, path, { url: 'https://a.example/mara.png', pieces: ['entry:2', 'entry:1'] })
    await addCardLink(folder, path, { url: 'https://b.example/mara.png', pieces: ['entry:7'] })

    expect((await listGallery(folder))[0]!.cardLinks).toEqual([
      { url: 'https://a.example/mara.png', pieces: ['entry:1', 'entry:2'] },
      { url: 'https://b.example/mara.png', pieces: ['entry:7'] },
    ])
  })
})

describe('a page of the gallery', () => {
  it('holds the pictures that match the filter from the offset, with the counts of the whole gallery and how many wait for a description', async () => {
    for (const number of [1, 2, 3]) await put(`scenes/turn-n${number}-01.png`, { schema: 'dsh-roleplay-image/v3', purpose: 'transient', origin: 'generated', createdAt: `2026-02-0${number}T00:00:00.000Z`, subjects: [] })
    await put('characters/4/reference.png', { schema: 'dsh-roleplay-image/v3', purpose: 'reference', origin: 'generated', createdAt: '2026-01-01T00:00:00.000Z', subjects: [] })
    await put('library/a.png', { schema: 'dsh-roleplay-image/v3', purpose: 'uploaded', origin: 'uploaded', createdAt: '2026-03-01T00:00:00.000Z', subjects: [] })
    const images = await listGallery(folder)
    const page = pageOf(images, {}, { offset: 1, limit: 2, filter: 'transient' })
    expect(page.images.map(image => image.path)).toEqual(['scenes/turn-n2-01.png', 'scenes/turn-n1-01.png'])
    expect(page).toMatchObject({ total: 3, counts: { all: 5, transient: 3, reference: 1, uploaded: 1 }, waiting: 1 })
    expect(pageOf(images, { 'library/a.png': 'no model' }, { offset: 0, limit: 10, filter: 'uploaded' }).waiting).toBe(0)
    expect(pageOf(images, {}, { offset: 10, limit: 10, filter: 'all' }).images).toEqual([])
  })

  it('finds the metadata of a picture with a large body between its header and its end', async () => {
    const body = Buffer.alloc(2_000_000)
    const length = Buffer.alloc(4)
    length.writeUInt32BE(body.length)
    const big = Buffer.concat([PNG.subarray(0, 33), length, Buffer.from('prVt'), body, Buffer.alloc(4), PNG.subarray(33)])
    await mkdir(join(folder, 'images', 'library'), { recursive: true })
    await writeFile(join(folder, 'images', 'library', 'big.png'), withPngMetadata(big, { schema: 'dsh-roleplay-image/v3', purpose: 'uploaded', origin: 'uploaded', createdAt: '2026-03-01T00:00:00.000Z', description: 'A pier.', subjects: [] }))
    expect(await listGallery(folder)).toMatchObject([{ path: 'library/big.png', description: 'A pier.' }])
  })
})
