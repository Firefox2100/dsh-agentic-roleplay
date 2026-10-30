import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../../src/host/agents/child.ts', async (original) => ({ ...(await original<typeof import('../../../src/host/agents/child.ts')>()), runChild: vi.fn() }))

const { runChild } = await import('../../../src/host/agents/child.ts')
const { contextOf } = await import('../../../src/host/import/tools.ts')

const settings = { maxUploadBytes: 1, concurrency: 1, reasoning: '', model: '', maxTokens: 16000, variablesPerRequest: 25, structured: 'schema' as const, temperature: 0.2, timeoutMinutes: 0, decisions: 'llm' as const, confidence: 0.7 }
const exec = (provider: string) => ({
  agent: { session: { requestHeader: () => ({ config: { provider, model: 'm' } }) }, ctx: { llm: { resolveModelInfo: async () => ({ context: { contextWindow: 100_000 } }) } } },
  signal: new AbortController().signal,
}) as never
const job = { persona: 'p', prompt: 'q', result: { type: 'object', properties: {} } as never }
const asked = (): { structured?: boolean }[] => vi.mocked(runChild).mock.calls.map(call => call[0] as { structured?: boolean })

beforeEach(() => { vi.mocked(runChild).mockReset() })

describe('asking helpers for a constrained JSON reply', () => {
  it('is the default way, and an endpoint that will not take the schema is asked by a tool call from then on, without the run counting as an attempt', async () => {
    vi.mocked(runChild).mockRejectedValueOnce(new Error('the agent failed: 400 Unrecognized request argument supplied: response_format')).mockResolvedValue({ ok: true })
    const context = contextOf(exec('picky'), settings, () => '')
    expect(await context.run(job)).toEqual({ ok: true })
    expect(asked().map(call => call.structured)).toEqual([true, undefined])
    await context.run(job)
    expect(asked().map(call => call.structured)).toEqual([true, undefined, undefined])
    await contextOf(exec('other'), settings, () => '').run(job)
    expect(asked().at(-1)!.structured).toBe(true)
  })

  it('is not given up on for another reason: the run is tried again as it was', async () => {
    vi.mocked(runChild).mockRejectedValueOnce(new Error('the agent stopped without submitting a result')).mockResolvedValue({ ok: true })
    await contextOf(exec('fine'), settings, () => '').run(job)
    expect(asked().map(call => call.structured)).toEqual([true, true])
  })

  it('stays with the tool call when the settings say so', async () => {
    vi.mocked(runChild).mockResolvedValue({ ok: true })
    await contextOf(exec('fine'), { ...settings, structured: 'tool' }, () => '').run(job)
    expect(asked()[0]!.structured).toBeUndefined()
  })
})
