import { describe, expect, it, vi } from 'vitest'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { canReadImages } from '../../../src/host/images/interpreter.ts'

/** A chat whose model is selected on the agent, in its request header, both or neither. */
function chat(selected: { provider: string; model: string } | undefined, header: { provider: string; model: string } | undefined) {
  const resolve = vi.fn(async (_provider: string, model: string) => ({ inputModalities: model === 'vision' ? ['text', 'image'] : ['text'] }))
  const agent = { model: { current: () => selected }, session: { requestHeader: () => (header === undefined ? undefined : { config: header }) }, ctx: { llm: { resolveModelInfo: resolve } } } as unknown as Agent
  return { agent, resolve }
}

describe('the model that describes a picture', () => {
  it('is the one selected on the chat even when it has not been prompted yet and its request header holds no model', async () => {
    const { agent, resolve } = chat({ provider: 'local', model: 'vision' }, undefined)
    expect(await canReadImages(agent, '', new AbortController().signal)).toBe(true)
    expect(resolve).toHaveBeenCalledWith('local', 'vision', expect.anything())
  })

  it('is the selected one before the header\'s, the header\'s when none is selected, and an explicit choice before both', async () => {
    const selected = chat({ provider: 'a', model: 'vision' }, { provider: 'b', model: 'text-only' })
    expect(await canReadImages(selected.agent, '', new AbortController().signal)).toBe(true)
    const header = chat(undefined, { provider: 'b', model: 'vision' })
    expect(await canReadImages(header.agent, '', new AbortController().signal)).toBe(true)
    const named = chat({ provider: 'a', model: 'text-only' }, undefined)
    expect(await canReadImages(named.agent, 'c/vision', new AbortController().signal)).toBe(true)
    expect(named.resolve).toHaveBeenCalledWith('c', 'vision', expect.anything())
  })

  it('cannot read images when no model is selected anywhere, or the model is not declared to', async () => {
    expect(await canReadImages(chat(undefined, undefined).agent, '', new AbortController().signal)).toBe(false)
    expect(await canReadImages(chat({ provider: 'a', model: 'text-only' }, undefined).agent, '', new AbortController().signal)).toBe(false)
  })
})
