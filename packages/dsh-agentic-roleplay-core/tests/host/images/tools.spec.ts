import { mkdtemp, rm } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ImageGenerationService, type ImageGenerationOptions, type ImageGenerationResult } from 'dsh-ai-core'
import { createSessionStore, type NewCharacter } from 'dsh-roleplay-state'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { shippedPromptsDirectory } from '../../../src/host/prompts/library.ts'
import { imageTools } from '../../../src/host/images/tools.ts'
import { addToLibrary } from '../../../src/host/images/library.ts'
import { updateImage } from '../../../src/host/images/gallery.ts'
import { presentedFor } from '../../../src/host/images/presented.ts'

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64')
const roots: string[] = []
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))) })

class Images extends ImageGenerationService {
  readonly provider = 'test'
  readonly model = 'paint-1'
  calls: { references: number }[] = []
  async generate(_prompt: string, options: ImageGenerationOptions = {}): Promise<ImageGenerationResult> { this.calls.push({ references: options.references?.length ?? 0 }); return { model: this.model, images: [{ data: new Blob([PNG], { type: 'image/png' }), mediaType: 'image/png' }] } }
}

const character: NewCharacter = {
  sourceId: 'mira', name: 'Mira', aliases: [], kind: 'person', tier: 'principal', role: 'npc', control: 'agent',
  summary: 'A watchful courier.', personality: '', background: '', appearance: 'Long black hair and grey eyes.', speech: { style: '', examples: [] },
}

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'image-tools-'))
  roots.push(root)
  const story = createSessionStore(':memory:', { id: 'session-1', name: 'S', world: { id: 'w', name: 'W' } })
  const stored = story.characters.add(character)
  story.characterStates.create(stored.id, { publicState: 'Rain-soaked.', innerState: '', activity: 'waiting under the awning' })
  const generated: string[] = []
  const service = new Images()
  return { root, story, service, generated, tools: imageTools({ root, story, service, turn: 4, timelineNode: 'n7', generated }) }
}

async function call(tools: ReturnType<typeof imageTools>, name: string, args: Record<string, unknown>): Promise<unknown> {
  const tool = tools.find(candidate => candidate.name === name)
  if (tool === undefined) throw new Error(`missing ${name}`)
  return tool.execute(args as never, {} as never)
}

describe('image author tools', () => {
  it('give the child only the dedicated visual workflow', async () => {
    const { tools } = await fixture()
    expect(tools.map(tool => tool.name)).toEqual(['list_visual_subjects', 'set_visual_identity', 'generate_reference_image', 'generate_transient_image'])
    expect(readFileSync(join(shippedPromptsDirectory(), 'en/roleplay/image-presenter.md'), 'utf8')).toContain('Canonical identity and transient state are separate')
  })

  it('establishes identity and generates reference and transient images', async () => {
    const { tools, service, generated } = await fixture()
    const listed = await call(tools, 'list_visual_subjects', { kind: 'character' }) as { key: string; current: string }[]
    expect(listed).toMatchObject([{ key: 'mira', current: 'Rain-soaked.; waiting under the awning' }])
    await call(tools, 'set_visual_identity', { kind: 'character', key: 'mira', description: 'Long black hair and grey eyes.', tags: ['black hair'], negative_tags: ['blue eyes'] })
    expect(await call(tools, 'generate_reference_image', { kind: 'character', key: 'mira' })).toEqual({ path: 'images/characters/mira/reference.png' })
    expect(await call(tools, 'generate_transient_image', { scene: 'Mira waits beneath an awning in the rain.', subjects: [{ kind: 'character', key: 'mira', transient: 'Rain-soaked coat; guarded expression.' }] })).toEqual({ path: 'images/scenes/turn-n7-01.png', serial: 1 })
    expect(await call(tools, 'generate_transient_image', { scene: 'A closer view of the same established moment.', subjects: [{ kind: 'character', key: 'mira', transient: 'Rain-soaked coat; guarded expression.' }] })).toEqual({ path: 'images/scenes/turn-n7-02.png', serial: 2 })
    expect(generated).toEqual(['images/characters/mira/reference.png', 'images/scenes/turn-n7-01.png', 'images/scenes/turn-n7-02.png'])
    expect(service.calls).toEqual([{ references: 0 }, { references: 1 }, { references: 1 }])
  })

  it('refuses generation before canonical identity exists', async () => {
    const { tools } = await fixture()
    await expect(call(tools, 'generate_reference_image', { kind: 'character', key: 'mira' })).rejects.toThrow(/no visual identity/)
  })
})

describe('the tools that look in the library', () => {
  it('are offered only when the library is asked for', async () => {
    const { root, story, service, generated } = await fixture()
    expect(imageTools({ root, story, service, turn: 1, timelineNode: 'n1', generated, library: true }).map(tool => tool.name)).toEqual(['list_visual_subjects', 'set_visual_identity', 'generate_reference_image', 'generate_transient_image', 'search_images', 'use_existing_image'])
  })

  it('find what was described and show it for the turn, and refuse what cannot be shown', async () => {
    const { root, story, service, generated } = await fixture()
    const tools = imageTools({ root, story, service, turn: 4, timelineNode: 'n7', generated, library: true })
    const dock = await addToLibrary(root, PNG, 'dock.png')
    const pending = await addToLibrary(root, PNG, 'later.png')
    await updateImage(root, dock, { description: 'Mira waits on the foggy dock at dawn.', tags: ['fog', 'dawn'], subjects: [{ kind: 'character', name: 'Mira' }] })
    const found = await call(tools, 'search_images', { text: 'Mira in the fog', subjects: ['Mira'] }) as { matches: { path: string }[]; pictures: unknown[] }
    expect(found.matches.map(entry => entry.path)).toEqual([dock])
    expect(found.pictures).toEqual([])
    expect(await call(tools, 'search_images', { text: 'volcano' })).toMatchObject({ matches: [] })
    const unsearched = imageTools({ root, story, service, turn: 4, timelineNode: 'n7', generated: [], library: true })
    await expect(call(unsearched, 'use_existing_image', { path: dock, reason: 'x' })).rejects.toThrow('was not among the results')
    await expect(call(tools, 'use_existing_image', { path: pending, reason: 'x' })).rejects.toThrow('was not among the results')
    expect(await call(tools, 'use_existing_image', { path: dock, reason: 'same dock, same fog' })).toEqual({ path: dock })
    expect(generated).toEqual([dock])
    expect(await presentedFor(root, 'n7')).toMatchObject([{ path: dock, reason: 'same dock, same fog' }])
  })

  it('show the agent the pictures themselves with the results, when its model can see them, and judge by description when it cannot', async () => {
    const { root, story, service, generated } = await fixture()
    const dock = await addToLibrary(root, PNG, 'dock.png')
    await updateImage(root, dock, { description: 'Mira waits on the foggy dock at dawn.', subjects: [{ kind: 'character', name: 'Mira' }] })
    const saveImage = vi.fn(async () => ({ attachmentId: 'sha256:x', mediaType: 'image/png', bytes: 1, width: 1, height: 1 }))
    const seeing = imageTools({ root, story, service, turn: 1, timelineNode: 'n1', generated, library: true, attachments: { saveImage } as never, sees: true })
    const found = await call(seeing, 'search_images', { text: 'Mira on the dock' }) as { pictures: { path: string }[] }
    expect(found.pictures.map(picture => picture.path)).toEqual([dock])
    expect(saveImage).toHaveBeenCalledTimes(1)
    const tool = seeing.find(candidate => candidate.name === 'search_images')!
    const blocks = (tool as unknown as { output: { render(args: unknown, value: unknown): { type: string }[] } }).output.render({}, found)
    expect(blocks.map(block => block.type)).toEqual(['text', 'text', 'image'])
    const blind = imageTools({ root, story, service, turn: 1, timelineNode: 'n1', generated, library: true, attachments: { saveImage } as never, sees: false })
    expect(((await call(blind, 'search_images', { text: 'Mira on the dock' })) as { pictures: unknown[] }).pictures).toEqual([])
    expect(saveImage).toHaveBeenCalledTimes(1)
  })

  it('also find by meaning when there is an embedding service, and keep the vectors', async () => {
    const { root, story, service, generated } = await fixture()
    const harbour = await addToLibrary(root, PNG, 'harbour.png')
    const forest = await addToLibrary(root, PNG, 'forest.png')
    await updateImage(root, harbour, { description: 'Ships rest in the harbour.' })
    await updateImage(root, forest, { description: 'Trees in a quiet wood.' })
    const embed = vi.fn(async (texts: readonly string[], _options?: Record<string, unknown>) => ({ model: 'm', dimensions: 2, vectors: texts.map(text => (/ship|harbour|boat/i.test(text) ? [1, 0] : [0, 1])) }))
    const tools = imageTools({ root, story, service, turn: 1, timelineNode: 'n1', generated, library: true, embedder: { embed } })
    const found = await call(tools, 'search_images', { text: 'a boat at anchor' }) as { matches: { path: string }[]; semantic: boolean }
    expect(found.semantic).toBe(true)
    expect(found.matches.map(match => match.path)).toEqual([harbour])
    expect(existsSync(join(root, 'images', '.vectors.json'))).toBe(true)
    await call(tools, 'search_images', { text: 'a boat at anchor' })
    expect(embed.mock.calls.filter(call => call[1]?.inputType === 'document')).toHaveLength(1)
    const broken = imageTools({ root, story, service, turn: 1, timelineNode: 'n1', generated, library: true, embedder: { embed: async () => { throw new Error('down') } } })
    expect((await call(broken, 'search_images', { text: 'harbour' }) as { semantic: boolean }).semantic).toBe(false)
  })
})
