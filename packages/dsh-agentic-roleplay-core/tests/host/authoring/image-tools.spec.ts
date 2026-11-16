import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { worldImageTools } from '../../../src/host/authoring/image-tools.ts'
import { authoringApproval } from '../../../src/host/authoring/write-tools.ts'
import { authoringChatSessionId } from '../../../src/shared/authoring-chat.ts'
import { addToLibraryOnce } from '../../../src/host/images/library.ts'

// Describing a picture asks a model to read it; what that model says is exercised in the interpreter tests, so here it is a stand-in.
const { interpretImage } = vi.hoisted(() => ({ interpretImage: vi.fn() }))
vi.mock('../../../src/host/images/interpreter.ts', () => ({ interpretImage }))

let directory: string
beforeEach(async () => { directory = await mkdtemp(join(tmpdir(), 'world-images-')) })
afterEach(async () => { await rm(directory, { recursive: true, force: true }) })

// a minimal PNG: signature, header, one pixel, end
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==', 'base64')
const state = { characters: [{ name: 'Mara' }, { name: 'Tam' }], places: [{ name: 'Dock' }], things: [{ name: 'Lantern' }] }
const reader = { read: () => Promise.resolve({ record: { directory, summary: { id: 'harbor' } }, state }) } as never
const call = (name: string, args: Record<string, unknown>, attachments: unknown = undefined) => {
  const tool = worldImageTools(reader, { language: () => 'en', attachments: () => attachments as never }).find(candidate => candidate.name === name)!
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

  it('describes a picture under the authoring chat, over every name the world has, and passes on what it knows of it', async () => {
    const { path } = await addToLibraryOnce(directory, PNG, 'mara.png')
    interpretImage.mockResolvedValueOnce({ path, description: 'Mara at the dock.', tags: ['dock'], subjects: [{ kind: 'character', name: 'Mara' }] })

    const described = await call('describe_world_image', { path, context: 'her card says this is her' }, { saveImage: async () => ({}) }) as { action: string; description: string; subjects: unknown[] }

    expect(described).toMatchObject({ action: 'described', path, description: 'Mara at the dock.', subjects: [{ kind: 'character', name: 'Mara' }] })
    expect(interpretImage).toHaveBeenCalledTimes(1)
    expect(interpretImage.mock.calls[0]![0]).toMatchObject({
      path,
      context: 'her card says this is her',
      sessionFolder: directory,
      language: 'en',
      subjects: [{ kind: 'character', name: 'Mara' }, { kind: 'character', name: 'Tam' }, { kind: 'location', name: 'Dock' }, { kind: 'item', name: 'Lantern' }],
    })
  })

  it('lists pictures without holding the turn, and leaves the describing out of the parallel-safe set', () => {
    const tools = worldImageTools(reader, { language: () => 'en', attachments: () => undefined })
    const safeOf = (name: string) => (tools.find(tool => tool.name === name) as unknown as { isConcurrencySafe?: (args: unknown) => boolean }).isConcurrencySafe
    expect(safeOf('list_world_images')?.({})).toBe(true)
    expect(safeOf('describe_world_image'), 'describing runs a model, so it does not run beside the turn').toBeUndefined()
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
