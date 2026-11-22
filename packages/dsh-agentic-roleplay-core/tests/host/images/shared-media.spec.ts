import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { describeWhereHeld, galleryFile, listGallery, updateImage } from '../../../src/host/images/gallery.ts'
import { addToLibraryOnce } from '../../../src/host/images/library.ts'
import { withPngMetadata } from '../../../src/host/images/png-metadata.ts'
import { baseWorld, sharedFile, shareWorldImages } from '../../../src/host/images/shared-media.ts'
import { present } from '../../../src/host/images/presented.ts'
import { inheritImages } from '../../../src/host/images/storage.ts'

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64')
const described = { schema: 'dsh-roleplay-image/v3', purpose: 'uploaded', origin: 'uploaded', reusable: true, createdAt: '2026-03-01T00:00:00.000Z', description: 'A pier.', tags: [], subjects: [] }

let root: string
let world: string
let story: string
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'shared-media-'))
  world = join(root, 'worlds', 'harbor')
  story = join(root, 'sessions', '11111111-1111-4111-8111-111111111111')
  await mkdir(join(world, 'images', 'library'), { recursive: true })
  await mkdir(join(world, 'images', 'characters', 'mira'), { recursive: true })
  await mkdir(story, { recursive: true })
  await writeFile(join(world, 'images', 'library', 'pier.png'), withPngMetadata(PNG, described))
  await writeFile(join(world, 'images', 'characters', 'mira', 'reference.png'), withPngMetadata(PNG, { ...described, purpose: 'reference', origin: 'generated' }))
})
afterEach(async () => { await rm(root, { recursive: true, force: true }) })

describe('the pictures a story shares with its world', () => {
  it('starts with none of its own, lists and serves the world\'s, and keeps nothing it did not use', async () => {
    expect(await shareWorldImages(story, world)).toBe(true)
    expect(baseWorld(story)).toBe(world)
    expect(existsSync(join(story, 'images', 'library', 'pier.png'))).toBe(false)
    expect((await listGallery(story)).map(image => image.path).sort()).toEqual(['characters/mira/reference.png', 'library/pier.png'])
    expect((await galleryFile(story, 'library/pier.png')).file).toBe(join(world, 'images', 'library', 'pier.png'))
    expect(sharedFile(story, join(story, 'images', 'characters', 'mira', 'reference.png'))).toBe(join(world, 'images', 'characters', 'mira', 'reference.png'))
    expect(existsSync(join(story, 'images', 'library', 'pier.png'))).toBe(false)
  })

  it('describes a picture the story only reads in the world, and presenting it gives the story a copy', async () => {
    await writeFile(join(world, 'images', 'library', 'bare.png'), PNG)
    await shareWorldImages(story, world)
    const image = await describeWhereHeld(story, 'library/bare.png', { description: 'A bare quay.' })
    expect(image.description).toBe('A bare quay.')
    expect(existsSync(join(story, 'images', 'library', 'bare.png'))).toBe(false)
    expect((await listGallery(world)).find(entry => entry.path === 'library/bare.png')?.description).toBe('A bare quay.')
    await present(story, 'n1', { path: 'library/bare.png', reason: 'fits' })
    expect(existsSync(join(story, 'images', 'library', 'bare.png'))).toBe(true)
  })

  it('gives the story a file of its own when it changes a picture, and leaves the world\'s as it was', async () => {
    await shareWorldImages(story, world)
    const before = await readFile(join(world, 'images', 'library', 'pier.png'))
    await updateImage(story, 'library/pier.png', { description: 'A pier at dusk.' })
    expect(await readFile(join(world, 'images', 'library', 'pier.png'))).toEqual(before)
    expect((await listGallery(story)).find(image => image.path === 'library/pier.png')?.description).toBe('A pier at dusk.')
    expect((await stat(join(story, 'images', 'library', 'pier.png'))).isFile()).toBe(true)
  })

  it('does not add a picture the world already has, and lists only its own once the world is gone', async () => {
    await shareWorldImages(story, world)
    expect(await addToLibraryOnce(story, await readFile(join(world, 'images', 'library', 'pier.png')), 'again.png')).toEqual({ path: 'library/pier.png', added: false })
    await rm(world, { recursive: true })
    expect(await listGallery(story)).toEqual([])
    expect(baseWorld(story)).toBeUndefined()
  })

  it('is not made for a world outside the root\'s worlds folder, and a branch keeps the pointer', async () => {
    expect(await shareWorldImages(story, join(root, 'elsewhere'))).toBe(false)
    await shareWorldImages(story, world)
    const branch = join(root, 'sessions', '22222222-2222-4222-8222-222222222222')
    await mkdir(branch, { recursive: true })
    await inheritImages(story, branch, [])
    expect(baseWorld(branch)).toBe(world)
  })
})
