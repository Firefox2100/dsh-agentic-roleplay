import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ImageGenerationService, type ImageGenerationOptions, type ImageGenerationResult } from 'dsh-ai-core'
import { createSessionStore, type NewCharacter } from 'dsh-roleplay-state'
import { afterEach, describe, expect, it } from 'vitest'
import { IMAGE_AUTHOR_PERSONA } from '../../../src/host/images/author-agent.ts'
import { imageTools } from '../../../src/host/images/tools.ts'

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
    expect(IMAGE_AUTHOR_PERSONA).toContain('Canonical identity and transient state are separate')
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
