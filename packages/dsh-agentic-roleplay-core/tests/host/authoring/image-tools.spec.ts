import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { worldImageTools } from '../../../src/host/authoring/image-tools.ts'
import { authoringApproval } from '../../../src/host/authoring/write-tools.ts'
import { authoringChatSessionId } from '../../../src/shared/authoring-chat.ts'
import { addToLibraryOnce } from '../../../src/host/images/library.ts'

let directory: string
beforeEach(async () => { directory = await mkdtemp(join(tmpdir(), 'world-images-')) })
afterEach(async () => { await rm(directory, { recursive: true, force: true }) })

// a minimal PNG: signature, header, one pixel, end
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==', 'base64')
const state = { characters: [{ name: 'Mara' }, { name: 'Tam' }], places: [{ name: 'Dock' }], things: [] }
const reader = { read: () => Promise.resolve({ record: { directory, summary: { id: 'harbor' } }, state }) } as never
const call = (name: string, args: Record<string, unknown>) => {
  const tool = worldImageTools(reader, { language: () => 'en', attachments: () => undefined }).find(candidate => candidate.name === name)!
  return (tool as unknown as { execute(args: unknown, exec: unknown): Promise<unknown> }).execute(args, { agent: { session: { id: 'x' } }, signal: new AbortController().signal })
}
const exec = (name: string, args: Record<string, unknown>) => ({ name, arguments: args, agent: { session: { id: authoringChatSessionId('harbor') } } }) as never

describe('the picture tools of world authoring', () => {
  it('list the pictures with where each came from, and only those without a description when asked', async () => {
    const { path } = await addToLibraryOnce(directory, PNG, 'mara.png', undefined, { url: 'https://a.example/mara.png', pieces: ['field:description'] })
    const all = await call('list_world_images', {}) as { count: number; images: { path: string; cardLinks?: unknown }[] }
    expect(all).toMatchObject({ count: 1, images: [{ path, cardLinks: [{ url: 'https://a.example/mara.png', pieces: ['field:description'] }] }] })
    await call('edit_world_image', { path, description: 'Mara at the dock.' })
    expect(((await call('list_world_images', { undescribed: true })) as { count: number }).count).toBe(0)
  })

  it('correct the description, tags and subjects, refuse a subject the world does not have, and keep the source', async () => {
    const { path } = await addToLibraryOnce(directory, PNG, 'mara.png', undefined, { url: 'https://a.example/mara.png', pieces: ['entry:3'] })
    const edited = await call('edit_world_image', { path, description: ' Mara at the dock. ', tags: ['dock', ' '], subjects: [{ kind: 'character', name: 'Mara' }, { kind: 'location', name: 'Dock' }] }) as { description: string; tags: string[]; subjects: unknown[] }
    expect(edited).toMatchObject({ description: 'Mara at the dock.', tags: ['dock'], subjects: [{ kind: 'character', name: 'Mara' }, { kind: 'location', name: 'Dock' }] })
    await expect(call('edit_world_image', { path, subjects: [{ kind: 'character', name: 'Nobody' }] })).rejects.toThrow(/Nobody \(character\) is not in this world.*Mara/)
    expect(((await call('list_world_images', {})) as { images: { cardLinks: unknown }[] }).images[0]!.cardLinks).toEqual([{ url: 'https://a.example/mara.png', pieces: ['entry:3'] }])
  })

  it('cannot describe a picture without a service that shows pictures to a model', async () => {
    const { path } = await addToLibraryOnce(directory, PNG, 'mara.png')
    await expect(call('describe_world_image', { path })).rejects.toThrow(/no attachment service/)
  })

  it('ask the person before a picture is changed or described, except in the turn that has just imported a card', async () => {
    for (const name of ['edit_world_image', 'describe_world_image']) {
      const ran: string[] = []
      const asked = await authoringApproval(exec(name, { path: 'library/a.png' }), () => { ran.push(name); return Promise.resolve({ kind: 'allow' } as never) })
      expect(asked).toMatchObject({ kind: 'ask' })
      expect(ran).toEqual([])
      const reviewing = await authoringApproval(exec(name, { path: 'library/a.png' }), () => Promise.resolve({ kind: 'allow' } as never), () => Promise.resolve(true))
      expect(reviewing).toMatchObject({ kind: 'allow' })
    }
  })
})
