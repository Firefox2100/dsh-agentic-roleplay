import { describe, expect, it } from 'vitest'
import { childModel, childSampling, isUnfinishedCall, supportedEffort, enforcedSchema } from '../../../src/host/agents/child.ts'
import { DEFAULT_SETTINGS } from '../../../src/shared/settings.ts'

describe('childModel', () => {
  it('leaves a helper on the chat\'s own model when none is named', () => {
    expect(childModel(DEFAULT_SETTINGS, 'characters')).toEqual({})
  })

  it('names the provider and the model of the kind of helper, keeping slashes in the model', () => {
    const settings = { ...DEFAULT_SETTINGS, models: { ...DEFAULT_SETTINGS.models, characters: ' localai/qwen/small ', records: 'openai/gpt-mini' } }
    expect(childModel(settings, 'characters')).toEqual({ model: { provider: 'localai', model: 'qwen/small' } })
    expect(childModel(settings, 'records')).toEqual({ model: { provider: 'openai', model: 'gpt-mini' } })
    expect(childModel(settings, 'characters', 'localai/tiny')).toEqual({ model: { provider: 'localai', model: 'tiny' } })
    expect(childModel(settings, 'characters', '')).toEqual({})
    expect(childModel(settings, 'suggestions')).toEqual({})
  })
})

describe('what an answer is checked against', () => {
  const result = { type: 'object', properties: { thought: { type: 'string' }, intent: { type: 'string' } }, required: ['thought', 'intent'] } as never

  it('asks for what it does not enforce, and checks the rest', () => {
    expect(enforcedSchema({ result, unenforced: ['thought'] }).required).toEqual(['intent'])
    expect(enforcedSchema({ result }).required).toEqual(['thought', 'intent'])
    expect((result as { required: string[] }).required).toEqual(['thought', 'intent'])
  })
})

describe('childSampling', () => {
  it('cuts the helpers that answer briefly off much sooner than the ones that write records or make things up', () => {
    expect(childSampling(DEFAULT_SETTINGS, 'characters')).toMatchObject({ maxTokens: 2000, priority: 'foreground' })
    expect(childSampling(DEFAULT_SETTINGS, 'suggestions')).toMatchObject({ maxTokens: 2000, priority: 'background' })
    expect(childSampling(DEFAULT_SETTINGS, 'records').maxTokens).toBe(8000)
    expect(childSampling(DEFAULT_SETTINGS, 'authoring').maxTokens).toBe(8000)
  })

  it('lets a helper with a declared answer size produce that with room to spare, and never more than the ceiling of its kind', () => {
    expect(childSampling(DEFAULT_SETTINGS, 'characters', 400).maxTokens).toBe(800)
    expect(childSampling(DEFAULT_SETTINGS, 'characters', 5000).maxTokens).toBe(2000)
    expect(childSampling({ sampling: { ...DEFAULT_SETTINGS.sampling, headroom: 3 } }, 'characters', 401).maxTokens).toBe(1210)
    expect(childSampling(DEFAULT_SETTINGS, 'records', 5000).maxTokens).toBe(8000)
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
