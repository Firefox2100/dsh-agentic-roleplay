import { beforeEach, describe, expect, it, vi } from 'vitest'

const runChild = vi.fn(async (_task: Record<string, unknown>) => ({ reason: 'a door opening on nothing', worth: true }))

vi.mock('../../../src/host/agents/child.ts', () => ({ runChild }))
// The persona text is not what this test is about: what the child is asked and what comes back are.
vi.mock('../../../src/host/prompts/access.ts', () => ({ promptFor: (_agent: unknown, id: string, language: string) => `${id}/${language}` }))

const { WORTH_RESULT, worthAPicture } = await import('../../../src/host/images/worth.ts')

function jobOf(extra: Record<string, unknown> = {}): Parameters<typeof worthAPicture>[0] {
  return { parent: {} as never, signal: new AbortController().signal, language: 'en', moment: 'The door opens on the dark.', ...extra } as Parameters<typeof worthAPicture>[0]
}

beforeEach(() => { runChild.mockClear() })

describe('whether a moment is worth a picture', () => {
  it('hands the child the moment, the persona of the language and the shape of the answer', async () => {
    expect(await worthAPicture(jobOf())).toBe(true)

    expect(runChild).toHaveBeenCalledTimes(1)
    expect(runChild.mock.calls[0]![0]).toMatchObject({
      persona: 'roleplay/image-worth/en',
      prompt: 'The door opens on the dark.',
      result: WORTH_RESULT,
      maxCalls: 2,
    })
  })

  it('says no when the child judges the moment plain', async () => {
    runChild.mockResolvedValueOnce({ reason: 'nothing to look at', worth: false })
    expect(await worthAPicture(jobOf())).toBe(false)
  })

  it('passes a reasoning effort and a sampling only when the caller sets them', async () => {
    await worthAPicture(jobOf({ reasoningEffort: 'high' }))
    const asked = runChild.mock.calls[0]![0] as Record<string, unknown>
    expect(asked.reasoningEffort).toBe('high')
    expect('sampling' in asked).toBe(false)

    runChild.mockClear()
    await worthAPicture(jobOf({ sampling: { temperature: 0.2 } }))
    expect((runChild.mock.calls[0]![0] as Record<string, unknown>).sampling).toEqual({ temperature: 0.2 })
  })
})
