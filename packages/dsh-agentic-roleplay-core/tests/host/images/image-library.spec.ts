import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { GalleryImage } from '../../../src/shared/gallery.ts'
import { listGallery, updateImage, galleryFile } from '../../../src/host/images/gallery.ts'
import { searchImages, tokensOf } from '../../../src/host/images/image-search.ts'
import { addToLibrary, addToLibraryOnce, imageExtensionOf } from '../../../src/host/images/library.ts'
import { present, presentedFor } from '../../../src/host/images/presented.ts'
import { inheritImages } from '../../../src/host/images/storage.ts'
import { withPngMetadata } from '../../../src/host/images/png-metadata.ts'

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64')
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1])

let folder: string
beforeEach(async () => { folder = await mkdtemp(join(tmpdir(), 'library-')) })
afterEach(async () => { await rm(folder, { recursive: true, force: true }) })

const image = (over: Partial<GalleryImage>): GalleryImage => ({ path: 'x.png', purpose: 'transient', origin: 'generated', reusable: true, createdAt: '2026-01-01T00:00:00.000Z', tags: [], subjects: [], ...over })

describe('searching images', () => {
  it('reads words and, for scripts without spaces, overlapping pairs', () => {
    expect(tokensOf('Rain, on the Dock')).toEqual(['rain', 'dock'])
    expect(tokensOf('雨夜码头')).toEqual(['雨夜', '夜码', '码头'])
  })

  it('returns only reusable, described images, best first, and ranks the subjects asked for higher without requiring them', () => {
    const images = [
      image({ path: 'a.png', description: 'Mira stands on the foggy dock at dawn.', subjects: [{ kind: 'character', name: 'Mira' }, { kind: 'location', name: 'Dock' }] }),
      image({ path: 'b.png', description: 'A foggy street.', tags: ['fog'] }),
      image({ path: 'c.png', description: 'Mira on the dock', reusable: false, subjects: [{ kind: 'character', name: 'Mira' }] }),
      image({ path: 'd.png', pending: true, origin: 'uploaded', purpose: 'uploaded' }),
      image({ path: 'e.png', description: '雨夜的码头，一盏灯。', subjects: [{ kind: 'location', name: '码头' }] }),
    ]
    expect(searchImages(images, { text: 'Mira on the dock in fog' }).map(match => match.image.path)).toEqual(['a.png', 'b.png'])
    expect(searchImages(images, { text: 'fog', subjects: ['Mira'] }).map(match => match.image.path)).toEqual(['a.png', 'b.png'])
    expect(searchImages(images, { text: '码头下雨的夜晚' }).map(match => match.image.path)).toEqual(['e.png'])
    expect(searchImages(images, { text: 'volcano' })).toEqual([])
  })
})

describe('the library and the gallery listing', () => {
  it('adds an image by what it is, not by its name, with metadata saying it is the person\'s and reusable', async () => {
    expect(imageExtensionOf(PNG)).toBe('.png')
    expect(imageExtensionOf(JPEG)).toBe('.jpg')
    expect(imageExtensionOf(Buffer.from('hello world, not an image'))).toBeUndefined()
    const path = await addToLibrary(folder, PNG, 'My Dock Photo.jpg')
    expect(path).toBe('library/My-Dock-Photo.png')
    const jpeg = await addToLibrary(folder, JPEG, '雨夜.png')
    expect(jpeg).toBe('library/雨夜.jpg')
    expect(existsSync(join(folder, 'images', 'library', '雨夜.jpg.json'))).toBe(true)
    await expect(addToLibrary(folder, Buffer.from('nope'), 'a.png')).rejects.toThrow('only PNG')
    const listed = await listGallery(folder)
    expect(listed).toHaveLength(2)
    expect(listed.every(entry => entry.origin === 'uploaded' && entry.reusable && entry.pending === true && entry.purpose === 'uploaded')).toBe(true)
    expect(listed.find(entry => entry.path === path)?.originalName).toBe('My Dock Photo.jpg')
  })

  it('lists a file put in the library by hand as waiting to be described, and keeps what an update writes in the file', async () => {
    await mkdir(join(folder, 'images', 'library'), { recursive: true })
    await writeFile(join(folder, 'images', 'library', 'dropped.png'), PNG)
    await writeFile(join(folder, 'images', 'library', 'photo.webp'), Buffer.from('RIFF....WEBPVP8 '))
    expect((await listGallery(folder)).map(entry => [entry.path, entry.pending])).toEqual(expect.arrayContaining([['library/dropped.png', true], ['library/photo.webp', true]]))
    const updated = await updateImage(folder, 'library/dropped.png', { description: 'A foggy dock.', tags: ['fog'], subjects: [{ kind: 'location', name: 'Dock' }] })
    expect(updated).toMatchObject({ description: 'A foggy dock.', tags: ['fog'], subjects: [{ kind: 'location', name: 'Dock' }], reusable: true, origin: 'uploaded' })
    expect(updated.pending).toBeUndefined()
    const described = await updateImage(folder, 'library/photo.webp', { description: 'A photo.' })
    expect(described.pending).toBeUndefined()
    expect(JSON.parse(await readFile(join(folder, 'images', 'library', 'photo.webp.json'), 'utf8'))).toMatchObject({ description: 'A photo.', origin: 'uploaded' })
  })

  it('refuses to make an uploaded image not reusable, and lets a generated one be switched', async () => {
    await addToLibrary(folder, PNG, 'a.png')
    await expect(updateImage(folder, 'library/a.png', { reusable: false })).rejects.toThrow('always reusable')
    await mkdir(join(folder, 'images', 'scenes'), { recursive: true })
    await writeFile(join(folder, 'images', 'scenes', 'turn-n1-01.png'), withPngMetadata(PNG, { schema: 'dsh-roleplay-image/v3', purpose: 'transient', origin: 'generated', reusable: false, createdAt: '2026-01-01T00:00:00.000Z', prompt: 'p', subjects: [] }))
    expect((await listGallery(folder)).find(entry => entry.path === 'scenes/turn-n1-01.png')?.reusable).toBe(false)
    expect((await updateImage(folder, 'scenes/turn-n1-01.png', { reusable: true })).reusable).toBe(true)
  })

  it('remembers what it read, reads again only what changed, and survives losing its memory', async () => {
    await addToLibrary(folder, PNG, 'a.png')
    await listGallery(folder)
    const cache = join(folder, 'images', '.index.json')
    expect(existsSync(cache)).toBe(true)
    await updateImage(folder, 'library/a.png', { description: 'Changed.' })
    expect((await listGallery(folder))[0]?.description).toBe('Changed.')
    await rm(cache)
    expect((await listGallery(folder))[0]?.description).toBe('Changed.')
    await rm(join(folder, 'images', 'library', 'a.png'))
    expect(await listGallery(folder)).toEqual([])
  })

  it('serves library images of other formats, but only PNGs elsewhere', async () => {
    const jpeg = await addToLibrary(folder, JPEG, 'photo.jpg')
    expect(await galleryFile(folder, jpeg)).toMatchObject({ mediaType: 'image/jpeg' })
    await mkdir(join(folder, 'images', 'scenes'), { recursive: true })
    await writeFile(join(folder, 'images', 'scenes', 'x.jpg'), JPEG)
    await expect(galleryFile(folder, 'scenes/x.jpg')).rejects.toThrow('no such image')
  })
})

describe('showing an existing image', () => {
  it('records it once per node, and a branch keeps the library and only the records of the turns it keeps', async () => {
    const path = await addToLibrary(folder, PNG, 'a.png')
    await present(folder, 'n1', { path, reason: 'same dock' })
    await present(folder, 'n1', { path, reason: 'again' })
    await present(folder, 'n2', { path, reason: 'later turn' })
    expect((await presentedFor(folder, 'n1')).map(entry => entry.reason)).toEqual(['same dock'])
    expect(await presentedFor(folder, 'n9')).toEqual([])
    const branch = await mkdtemp(join(tmpdir(), 'branch-'))
    await inheritImages(folder, branch, ['n1'])
    expect(existsSync(join(branch, 'images', 'library', 'a.png'))).toBe(true)
    expect(await presentedFor(branch, 'n1')).toHaveLength(1)
    expect(await presentedFor(branch, 'n2')).toEqual([])
    await rm(branch, { recursive: true, force: true })
  })
})

describe('a picture the library holds already', () => {
  it('is not added again, whatever it is called and whatever its metadata says, from any source', async () => {
    const folder = await mkdtemp(join(tmpdir(), 'library-'))
    try {
      const first = await addToLibraryOnce(folder, PNG, 'first.png')
      expect(first.added).toBe(true)
      const again = await addToLibraryOnce(folder, withPngMetadata(PNG, { note: 'other metadata' }), 'second.png')
      expect(again).toEqual({ path: first.path, added: false })
      expect(await addToLibrary(folder, PNG, 'third.png')).toBe(first.path)
      expect(await readdir(join(folder, 'images', 'library'))).toHaveLength(1)
    } finally { await rm(folder, { recursive: true, force: true }) }
  })
})
