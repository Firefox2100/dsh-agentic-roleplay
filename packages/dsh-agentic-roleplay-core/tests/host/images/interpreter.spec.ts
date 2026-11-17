import { beforeEach, describe, expect, it, vi } from 'vitest'

const runChild = vi.fn(async (_task: Record<string, unknown>) => ({ description: ' A door in the dark. ', tags: ['door', ' '], subjects: [{ kind: 'character', name: 'Mara' }] }))
const readFile = vi.fn(async () => new Uint8Array([1, 2, 3]))
const galleryFile = vi.fn(async (_folder: string, path: string) => ({ file: `C:/images/${path}`, mediaType: 'image/png', size: 3 }))
const updateImage = vi.fn(async (_folder: string, path: string, update: Record<string, unknown>) => ({ path, ...update }))
const storySubjects = vi.fn(() => [
  { kind: 'character' as const, name: 'Mara', hidden: false },
  { kind: 'location' as const, name: 'The vault', hidden: true },
])

vi.mock('node:fs/promises', () => ({ readFile }))
vi.mock('../../../src/host/agents/child.ts', () => ({ runChild }))
vi.mock('../../../src/host/prompts/access.ts', () => ({ promptFor: (_agent: unknown, id: string, language: string) => `${id}/${language}` }))
vi.mock('../../../src/host/images/gallery.ts', () => ({ galleryFile, updateImage }))
vi.mock('../../../src/host/images/tools.ts', () => ({ storySubjects }))

const { interpretImage } = await import('../../../src/host/images/interpreter.ts')

type Job = Parameters<typeof interpretImage>[0]

function parentOf(reads: boolean, caption = 'a door, dark'): Job['parent'] {
  return {
    model: { current: () => ({ provider: 'deepseek', model: 'chat' }) },
    session: { requestHeader: () => ({ config: { provider: 'deepseek', model: 'chat' } }) },
    ctx: {
      llm: {
        resolveModelInfo: async () => ({ inputModalities: reads ? ['text', 'image'] : ['text'] }),
        stream: async function* () { yield { type: 'text-delta', text: caption } },
      },
    },
  } as unknown as Job['parent']
}

const attachments = { saveImage: async () => ({ attachmentId: 'attachment-1' }) as never }

function jobOf(extra: Record<string, unknown> = {}): Job {
  return {
    parent: parentOf(true),
    signal: new AbortController().signal,
    attachments,
    sessionFolder: 'C:/roleplay/sessions/one',
    path: 'library/door.png',
    language: 'en',
    ...extra,
  } as unknown as Job
}

beforeEach(() => {
  runChild.mockClear()
  galleryFile.mockClear()
  updateImage.mockClear()
})

describe('turning a picture into words a story can use', () => {
  it('offers only the subjects the story shows, asks one model to read the picture, and writes the answer back into the file', async () => {
    const image = await interpretImage(jobOf({ story: {} as never }))

    const prompt = (runChild.mock.calls[0]![0] as { prompt: string }).prompt
    expect(prompt).toContain('- Mara (character)')
    expect(prompt, 'a hidden subject must not be named to the model').not.toContain('The vault')
    expect(runChild.mock.calls[0]![0]).toMatchObject({ model: { provider: 'deepseek', model: 'chat' }, maxCalls: 4 })
    expect((runChild.mock.calls[0]![0] as { images: unknown[] }).images).toHaveLength(1)
    expect(updateImage).toHaveBeenCalledWith('C:/roleplay/sessions/one', 'library/door.png', expect.objectContaining({ description: 'A door in the dark.', tags: ['door'] }))
    expect(image).toMatchObject({ description: 'A door in the dark.' })
  })

  it('turns the words of a captioner into the description, with what is known of where the picture came from', async () => {
    await interpretImage(jobOf({ subjects: [{ kind: 'item', name: 'Key' }], captioner: 'deepseek/vision', context: '  a card said it shows the key  ' }))

    const asked = runChild.mock.calls[0]![0] as { prompt: string; images?: unknown[] }
    expect(asked.prompt).toContain('- Key (item)')
    expect(asked.prompt).toContain('Another model looked at the picture and wrote this caption')
    expect(asked.prompt).toContain('a card said it shows the key')
    expect('images' in asked, 'the captioner looked at the picture, so the second model is given words only').toBe(false)
    expect('model' in asked, 'a captioner leaves the structuring to the chat\'s own model').toBe(false)
  })

  it('refuses a model that is not declared able to read images, before reading the picture', async () => {
    await expect(interpretImage(jobOf({ parent: parentOf(false) }))).rejects.toThrow(/not declared able to read images/)
    expect(galleryFile).not.toHaveBeenCalled()
  })
})
