import { describe, expect, it } from 'vitest'
import { childModel, childSampling, isUnfinishedCall, supportedEffort } from '../../../src/host/agents/child.ts'
import { DEFAULT_SETTINGS } from '../../../src/shared/settings.ts'

describe('childModel', () => {
  it('leaves a helper on the chat\'s own model when none is named', () => {
    expect(childModel(DEFAULT_SETTINGS, 'characters')).toEqual({})
  })

  it('names the provider and the model of the kind of helper, keeping slashes in the model', () => {
    const settings = { ...DEFAULT_SETTINGS, models: { ...DEFAULT_SETTINGS.models, characters: ' localai/qwen/small ', records: 'openai/gpt-mini' } }
    expect(childModel(settings, 'characters')).toEqual({ model: { provider: 'localai', model: 'qwen/small' } })
    expect(childModel(settings, 'records')).toEqual({ model: { provider: 'openai', model: 'gpt-mini' } })
    expect(childModel(settings, 'suggestions')).toEqual({})
  })
})

describe('childSampling', () => {
  it('cuts the helpers that answer briefly off much sooner than the ones that write records or make things up', () => {
    expect(childSampling(DEFAULT_SETTINGS, 'characters')).toMatchObject({ maxTokens: 800, priority: 'foreground' })
    expect(childSampling(DEFAULT_SETTINGS, 'suggestions')).toMatchObject({ maxTokens: 800, priority: 'background' })
    expect(childSampling(DEFAULT_SETTINGS, 'records').maxTokens).toBe(8000)
    expect(childSampling(DEFAULT_SETTINGS, 'authoring').maxTokens).toBe(8000)
  })
})

describe('isUnfinishedCall', () => {
  it('knows the failure of a tool call that was cut off, and nothing else', () => {
    expect(isUnfinishedCall(new Error('the agent failed: the endpoint reported an error: rpc error: code = InvalidArgument desc = Failed to parse tool call arguments as JSON: missing closing quote'))).toBe(true)
    expect(isUnfinishedCall(new Error('the agent went on past its 40 calls'))).toBe(false)
    expect(isUnfinishedCall('Failed to parse tool call arguments')).toBe(false)
  })
})

describe('supportedEffort', () => {
  const parentWith = (efforts: string[] | undefined, fails = false) => ({ ctx: { llm: { resolveModelInfo: () => (fails ? Promise.reject(new Error('unknown model')) : Promise.resolve({ ...(efforts === undefined ? {} : { reasoning: { efforts: efforts.map(id => ({ id, name: id })) } }) })) } } }) as never
  const signal = new AbortController().signal

  it('keeps the level on the chat\'s own model, and on a chosen model that offers it', async () => {
    expect(await supportedEffort({ parent: parentWith(['high']), signal, reasoningEffort: 'off' })).toBe('off')
    expect(await supportedEffort({ parent: parentWith(['off', 'high']), signal, model: { provider: 'p', model: 'm' }, reasoningEffort: 'off' })).toBe('off')
  })

  it('drops the level a chosen model does not offer, and keeps it when the model cannot be looked up', async () => {
    expect(await supportedEffort({ parent: parentWith(undefined), signal, model: { provider: 'p', model: 'm' }, reasoningEffort: 'off' })).toBeUndefined()
    expect(await supportedEffort({ parent: parentWith(['high']), signal, model: { provider: 'p', model: 'm' }, reasoningEffort: 'off' })).toBeUndefined()
    expect(await supportedEffort({ parent: parentWith(undefined, true), signal, model: { provider: 'p', model: 'm' }, reasoningEffort: 'off' })).toBe('off')
  })
})
