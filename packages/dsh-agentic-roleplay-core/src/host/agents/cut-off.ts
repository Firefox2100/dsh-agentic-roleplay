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

/** What the model's last reply said in words (its thinking and its answer), or nothing when it has made none. */
export function lastReplyText(agent: Agent): string {
  const last = agent.session.snapshotEvents().findLast(event => event.type === 'assistant/message')
  if (last === undefined || last.type !== 'assistant/message') return ''
  const content = ((last.data as unknown) as { message?: { content?: { type?: string; text?: string }[] } }).message?.content ?? []
  return content.flatMap(block => (block.type === 'text' || block.type === 'reasoning') && typeof block.text === 'string' ? [block.text] : []).join('\n')
}

const MIN_LINES = 12
const REPEATED_SHARE = 0.3
const LONGEST_LINE = 12

/**
 * Whether a reply that was cut off was going round in circles: a model that "checks" the same things over and over in one reply (found live: an assistant wrote that it would look at
 * one card entry after another, six times over, and never called a tool) repeats whole lines. Steering it back with the same words only starts the next lap.
 */
export function goingRoundInCircles(text: string): boolean {
  const lines = text.split('\n').map(line => line.trim()).filter(line => line.length >= LONGEST_LINE)
  if (lines.length < MIN_LINES) return false
  const seen = new Set<string>()
  let repeated = 0
  for (const line of lines) {
    if (seen.has(line)) repeated += 1
    seen.add(line)
  }
  return repeated / lines.length >= REPEATED_SHARE
}
