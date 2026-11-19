import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createAuthoredEntity, deleteAuthoredEntity, mergeChanges, readAuthoredEntityDocument, replaceAuthoredEntity, updateAuthoredEntity } from '../../../src/host/authoring/documents.ts'

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

describe('changing some fields of an entity', () => {
  it('merges objects, removes a field on null and replaces a list or a text whole', () => {
    expect(mergeChanges({ name: 'A', start: { location: 'inn', activity: 'x' }, aliases: ['a', 'b'] }, { start: { location: 'yard' }, aliases: ['c'], name: null }))
      .toEqual({ start: { location: 'yard', activity: 'x' }, aliases: ['c'] })
  })

  it('changes one field of a stored document and keeps the rest', async () => {
    await createAuthoredEntity(world(), 'location', 'dock', { name: 'The Dock', description: 'Fog.' })
    await updateAuthoredEntity(world(), 'location', 'dock', { name: 'North Dock' })
    expect(await readAuthoredEntityDocument(world(), 'location', 'dock')).toEqual({ id: 'dock', name: 'North Dock', description: 'Fog.' })
  })

  it('refuses an empty change, an unknown entity and a result the format refuses, and writes nothing', async () => {
    await createAuthoredEntity(world(), 'location', 'dock', { name: 'The Dock' })
    await expect(updateAuthoredEntity(world(), 'location', 'dock', {})).rejects.toThrow('changes must be an object')
    await expect(updateAuthoredEntity(world(), 'location', 'nowhere', { name: 'X' })).rejects.toThrow('there is no location')
    await expect(updateAuthoredEntity(world(), 'location', 'dock', { name: null })).rejects.toThrow()
    expect(await readAuthoredEntityDocument(world(), 'location', 'dock')).toEqual({ id: 'dock', name: 'The Dock' })
  })

  it('says which keys there are when the key names nothing, and how to change what exists', async () => {
    await expect(updateAuthoredEntity(world(), 'character', 'Clara Voss', { name: 'X' })).rejects.toThrow('the character keys are: clara')
    await expect(createAuthoredEntity(world(), 'character', 'clara', { name: 'Clara' })).rejects.toThrow('update_world_element')
  })

  it('says a document folder cannot be read when it holds something other than a document', async () => {
    await mkdir(join(directory, 'characters', 'broken', 'character.json'), { recursive: true })
    await expect(deleteAuthoredEntity(world(), 'character', 'nobody')).rejects.toThrow(/EISDIR/)
  })
})
