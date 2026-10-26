import type { Agent } from '@deepseek-ai/dsh-agent'

/** How the model's last reply ended (`stop`, `tool-calls`, `max-tokens`), or nothing when it has made none. */
export function finishOf(agent: Agent): string | undefined {
  const last = agent.session.snapshotEvents().findLast(event => event.type === 'assistant/message')
  if (last === undefined || last.type !== 'assistant/message') return undefined
  const stream = (last.data as { stream?: { chunk?: { type?: string; reason?: { kind?: string } } }[] }).stream ?? []
  return stream.find(entry => entry.chunk?.type === 'finish')?.chunk?.reason?.kind
}

/** Whether the model's last reply ended because it reached the most it may write in one request. */
export const cutOff = (agent: Agent): boolean => finishOf(agent) === 'max-tokens'
