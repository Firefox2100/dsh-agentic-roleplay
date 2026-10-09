import { childSamplingOf, type ChildSampling } from '../../src/host/agents/child.ts'
import { LlmAdapter, type GenerateOptions, type LlmResolvedModelInfo, type StreamChunk } from '@deepseek-ai/dsh-llm'

/** A model that answers every request from a function of the request. */
export class ScriptedAdapter extends LlmAdapter {
  readonly requests: GenerateOptions[] = []
  /** The controls set for the helper that made each request, as they were while it ran. */
  readonly samplings: (ChildSampling | undefined)[] = []

  constructor(private readonly answer: (request: GenerateOptions) => StreamChunk[]) {
    super()
  }

  override resolveModel(provider: string, model: string): Promise<LlmResolvedModelInfo> {
    return Promise.resolve({ provider, id: model, name: model, context: { contextWindow: 100000 } })
  }

  async * stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    this.requests.push(options)
    this.samplings.push(options.sessionId === undefined ? undefined : childSamplingOf(String(options.sessionId)))
    for (const chunk of this.answer(options)) yield chunk
  }
}
