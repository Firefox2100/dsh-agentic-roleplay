import { lastAssistantStreamChunk } from '@deepseek-ai/dsh-llm'
import { NO_TOKENS, addTokens, type TokenCount } from '../../shared/usage.ts'

interface Logged { type: string; data?: unknown }

/** The tokens the model service reported for the requests it answered in a session's events; a request it reported nothing for adds nothing. */
export function tokensOf(events: readonly Logged[]): TokenCount {
  let total = NO_TOKENS
  for (const event of events) {
    if (event.type !== 'assistant/message') continue
    const usage = lastAssistantStreamChunk((event.data as { stream: Parameters<typeof lastAssistantStreamChunk>[0] }).stream, 'usage')?.usage
    if (usage === undefined) continue
    total = addTokens(total, { input: usage.inputTokens, cached: usage.cacheReadTokens ?? 0, output: usage.outputTokens })
  }
  return total
}
