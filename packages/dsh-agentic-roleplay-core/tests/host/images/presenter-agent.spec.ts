import { beforeEach, describe, expect, it, vi } from 'vitest'

const runChild = vi.fn(async (_task: { prompt?: string; trace?: unknown }) => ({
  summary: 'a picture of the door',
  images: [] as string[],
}))

vi.mock('../../../src/host/agents/child.ts', () => ({ runChild }))
vi.mock('../../../src/host/prompts/access.ts', () => ({ promptFor: () => 'be an image author' }))
vi.mock('../../../src/host/images/interpreter.ts', () => ({ canReadImages: async () => false }))
vi.mock('../../../src/host/images/tools.ts', () => ({ imageTools: () => [] }))

const { runImagePresenter } = await import('../../../src/host/images/presenter-agent.ts')

/** The least a job needs: the agent and the services are never reached, because the child that would use them is a stand-in. */
function jobOf(extra: Record<string, unknown> = {}): Parameters<typeof runImagePresenter>[0] {
  return {
    parent: {} as never,
    signal: new AbortController().signal,
    service: {} as never,
    story: {} as never,
    root: 'C:/roleplay',
    turn: 3,
    timelineNode: 'node-3',
    request: 'the door of the observatory',
    purpose: 'transient',
    language: 'en',
    ...extra,
  } as Parameters<typeof runImagePresenter>[0]
}

beforeEach(() => {
  runChild.mockClear()
})

describe('the agent that finds or makes a picture', () => {
  it('tells the caller what was made and hands the run to the child', async () => {
    const result = await runImagePresenter(jobOf())

    expect(result).toEqual({ summary: 'a picture of the door', images: [] })
    expect(runChild).toHaveBeenCalledTimes(1)
    expect((runChild.mock.calls[0]![0] as { prompt: string }).prompt).toContain('the door of the observatory')
  })

  it('passes the record of the run on when the caller wants it traced, and leaves it out otherwise', async () => {
    await runImagePresenter(jobOf({ trace: { dir: 'trace-1' } }))
    const traced = runChild.mock.calls[0]![0] as Record<string, unknown>
    expect(traced.trace).toEqual({ dir: 'trace-1' })

    runChild.mockClear()
    await runImagePresenter(jobOf())
    const plain = runChild.mock.calls[0]![0] as Record<string, unknown>
    expect('trace' in plain).toBe(false)
  })

  it('tells a reusing run to look first, and a fresh one to make the picture', async () => {
    await runImagePresenter(jobOf({ reuse: true }))
    expect((runChild.mock.calls[0]![0] as { prompt: string }).prompt).toContain('Find or create')

    runChild.mockClear()
    await runImagePresenter(jobOf({ purpose: 'reference' }))
    expect((runChild.mock.calls[0]![0] as { prompt: string }).prompt).toContain('canonical reference image')
  })
})
