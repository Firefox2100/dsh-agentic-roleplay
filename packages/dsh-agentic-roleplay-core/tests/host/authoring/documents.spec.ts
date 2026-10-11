import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createAuthoredEntity, deleteAuthoredEntity, readAuthoredEntityDocument, replaceAuthoredEntity } from '../../../src/host/authoring/documents.ts'

let directory: string
const world = () => ({ id: 'harbor', directory })

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'authoring-write-'))
  await mkdir(join(directory, 'characters', 'old-folder'), { recursive: true })
  await writeFile(join(directory, 'characters', 'old-folder', 'character.json'), `${JSON.stringify({ id: 'clara', name: 'Clara' })}\n`)
})

afterEach(async () => { await rm(directory, { recursive: true, force: true }) })

describe('authored entity documents', () => {
  it('creates, reads and replaces validated source documents', async () => {
    await createAuthoredEntity(world(), 'location', 'dock', { name: 'The Dock', description: 'Fog.' })
    expect(await readAuthoredEntityDocument(world(), 'location', 'dock')).toEqual({ id: 'dock', name: 'The Dock', description: 'Fog.' })
    await replaceAuthoredEntity(world(), 'location', 'dock', { id: 'ignored', name: 'North Dock' })
    expect(await readAuthoredEntityDocument(world(), 'location', 'dock')).toEqual({ id: 'dock', name: 'North Dock' })
  })

  it('rejects invalid documents before writing', async () => {
    await expect(createAuthoredEntity(world(), 'item', 'key', { name: 'Key' })).rejects.toThrow('exactly one')
    await expect(readFile(join(directory, 'items', 'key', 'item.json'))).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('refuses a key that would not make a safe folder or image path, and accepts one in any script', async () => {
    for (const key of ['[player]', 'a b', '../x', 'a/b', '.hidden', '']) {
      await expect(createAuthoredEntity(world(), 'location', key, { name: 'X' })).rejects.toThrow('key must be letters')
    }
    await createAuthoredEntity(world(), 'location', '值班室', { name: '值班室' })
    expect(await readAuthoredEntityDocument(world(), 'location', '值班室')).toMatchObject({ id: '值班室' })
  })

  it('deletes by moving the owning folder into hidden recoverable trash', async () => {
    const destination = await deleteAuthoredEntity(world(), 'character', 'clara')
    expect(destination).toContain(join(directory, '.trash', 'characters'))
    expect(JSON.parse(await readFile(join(destination, 'character.json'), 'utf8'))).toMatchObject({ id: 'clara' })
    await expect(readAuthoredEntityDocument(world(), 'character', 'clara')).rejects.toThrow('there is no character')
  })
})
