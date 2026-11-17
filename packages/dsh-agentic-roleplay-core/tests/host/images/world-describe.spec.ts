import { beforeEach, describe, expect, it, vi } from 'vitest'

const interpretImage = vi.fn(async (job: { sessionFolder: string; path: string }) => ({ path: job.path, description: 'A door.', tags: [], subjects: [] }))

vi.mock('../../../src/host/images/interpreter.ts', () => ({ interpretImage }))

const { describeWorldImage } = await import('../../../src/host/images/world-describe.ts')

const SUBJECTS = [{ kind: 'character', name: 'Mara' }] as const

function depsOf(extra: Record<string, unknown> = {}): Parameters<typeof describeWorldImage>[0] {
  return { directory: 'C:/roleplay/worlds/harbor', parent: {} as never, attachments: { saveImage: async () => ({}) as never }, language: 'en', subjects: SUBJECTS, ...extra } as Parameters<typeof describeWorldImage>[0]
}

beforeEach(() => { interpretImage.mockClear() })

describe('describing a picture of a world, from the world editor', () => {
  it('needs the attachment service before it needs anything else', async () => {
    await expect(describeWorldImage(depsOf({ attachments: undefined }), 'library/dock.png')).rejects.toThrow(/no attachment service/)
    expect(interpretImage).not.toHaveBeenCalled()
  })

  it('says which chat has to be running when the authoring chat is not loaded', async () => {
    await expect(describeWorldImage(depsOf({ parent: undefined }), 'library/dock.png')).rejects.toThrow(/authoring chat is not running/)
    expect(interpretImage).not.toHaveBeenCalled()
  })

  it('describes the picture under the authoring chat, in the world\'s language, over the world\'s names', async () => {
    const deps = depsOf()
    const image = await describeWorldImage(deps, 'library/dock.png')

    expect(image).toMatchObject({ path: 'library/dock.png', description: 'A door.' })
    expect(interpretImage).toHaveBeenCalledTimes(1)
    expect(interpretImage.mock.calls[0]![0]).toMatchObject({ sessionFolder: deps.directory, path: 'library/dock.png', language: 'en', subjects: SUBJECTS, parent: deps.parent })
  })
})
