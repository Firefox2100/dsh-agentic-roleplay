import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ImageGenerationService, type ImageGenerationResult } from 'dsh-ai-core'
import { afterEach, describe, expect, it } from 'vitest'
import { generateReferenceImage, generateTransientImage } from '../../../src/host/images/generator.ts'
import { readPngMetadata, withPngMetadata } from '../../../src/host/images/png-metadata.ts'
import { entityImageDirectory, inheritImages, readImageMetadata, sceneImagePath } from '../../../src/host/images/storage.ts'

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64')
const roots: string[] = []

afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))) })

class Images extends ImageGenerationService {
  readonly provider = 'test'
  readonly model = 'paint-1'
  async generate(prompt: string): Promise<ImageGenerationResult> {
    return { model: this.model, images: [{ data: new Blob([PNG], { type: 'image/png' }), mediaType: 'image/png', revisedPrompt: `${prompt} revised` }] }
  }
}

const identity = { subjectKind: 'character' as const, subjectId: 3, description: 'Black hair and grey eyes.', tags: ['black hair'], negativeTags: ['blue eyes'], version: 2, updatedAt: 'now' }

function root(): string {
  const value = join(tmpdir(), `roleplay-images-${process.pid}-${Date.now()}-${Math.random()}`)
  roots.push(value)
  return value
}

describe('PNG metadata', () => {
  it('round trips UTF-8 metadata and replaces its own chunk', () => {
    const first = withPngMetadata(PNG, { prompt: '雨の夜' })
    expect(readPngMetadata(first)).toEqual({ prompt: '雨の夜' })
    const second = withPngMetadata(first, { prompt: 'second' })
    expect(readPngMetadata(second)).toEqual({ prompt: 'second' })
  })
})

describe('image storage and unwired generators', () => {
  it('uses stable global and local entity paths', () => {
    expect(entityImageDirectory('/world', { kind: 'character', localId: 'alice' })).toBe('/world/images/characters/alice')
    expect(entityImageDirectory('/world', { kind: 'item', localId: 4, globalId: 'urn-4' })).toBe('/world/images/global/urn-4')
    expect(sceneImagePath('/session', 'n12', 2)).toBe('/session/images/scenes/turn-n12-02.png')
  })

  it('takes ids in any script and refuses what would leave the directory', () => {
    expect(entityImageDirectory('/world', { kind: 'character', localId: '陌白-福尔摩斯' })).toBe('/world/images/characters/陌白-福尔摩斯')
    for (const bad of ['..', 'a/b', '../x', '.hidden', 'a\\b', '']) expect(() => entityImageDirectory('/world', { kind: 'character', localId: bad })).toThrow(/not safe/)
  })

  it('writes a reference and transient scene as self-describing PNG files', async () => {
    const directory = root()
    const service = new Images()
    const subject = { kind: 'character' as const, localId: 3, name: 'Mira' }
    const reference = await generateReferenceImage(service, { root: directory, subject, identity })
    expect(reference).toBe(join(directory, 'images/characters/3/reference.png'))
    expect(await readImageMetadata(reference)).toMatchObject({ purpose: 'reference', provider: 'test', model: 'paint-1', subjects: [{ identityVersion: 2 }] })

    const scene = await generateTransientImage(service, { root: directory, timelineNode: 'n12', turn: 4, serial: 1, scene: 'Mira waits in the rain.', subjects: [{ ...subject, identity, transient: 'Wet coat, guarded expression.' }] })
    expect(scene).toBe(join(directory, 'images/scenes/turn-n12-01.png'))
    expect(await readImageMetadata(scene)).toMatchObject({ purpose: 'transient', source: { turn: 4, timelineNode: 'n12' } })
    expect(readPngMetadata(await readFile(scene))).toMatchObject({ schema: 'dsh-roleplay-image/v1' })
  })

  it('gives a branch all references but only scenes inherited by its timeline', async () => {
    const from = root()
    const to = root()
    await mkdir(join(from, 'images/characters/mira'), { recursive: true })
    await mkdir(join(from, 'images/scenes'), { recursive: true })
    await writeFile(join(from, 'images/characters/mira/reference.png'), PNG)
    await writeFile(join(from, 'images/scenes/turn-n1-01.png'), PNG)
    await writeFile(join(from, 'images/scenes/turn-n2-01.png'), PNG)
    await inheritImages(from, to, ['n1'])
    expect(await readFile(join(to, 'images/characters/mira/reference.png'))).toEqual(PNG)
    expect(await readFile(join(to, 'images/scenes/turn-n1-01.png'))).toEqual(PNG)
    await expect(readFile(join(to, 'images/scenes/turn-n2-01.png'))).rejects.toMatchObject({ code: 'ENOENT' })
  })
})
