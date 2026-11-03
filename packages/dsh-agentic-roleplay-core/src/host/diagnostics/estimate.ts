const WIDE = /[　-鿿가-힯＀-￯]/gu

/** What a text costs in tokens, roughly: a token holds about four letters of a western script and less than one character of a Chinese, Japanese or Korean one. Only for telling the parts of a prompt apart; the service's own count is what is reported for the whole. */
export function estimateTokens(text: string): number {
  if (text === '') return 0
  const wide = text.match(WIDE)?.length ?? 0
  return Math.ceil((text.length - wide) / 4 + wide * 0.7)
}

/** The text a block of a model message puts in the prompt. */
export function blockText(block: unknown): string {
  if (typeof block !== 'object' || block === null) return ''
  const entry = block as { type?: string; text?: unknown; arguments?: unknown; name?: unknown; content?: unknown }
  if (typeof entry.text === 'string') return entry.text
  if (entry.type === 'tool-call') return `${typeof entry.name === 'string' ? entry.name : ''}${typeof entry.arguments === 'string' ? entry.arguments : JSON.stringify(entry.arguments ?? '')}`
  if (entry.type === 'image') return ''
  return JSON.stringify(block)
}

/** The tokens of the content of one message of the log. */
export function messageTokens(message: unknown): number {
  const content = (message as { content?: unknown } | undefined)?.content
  if (typeof content === 'string') return estimateTokens(content)
  return Array.isArray(content) ? content.reduce((sum: number, block) => sum + estimateTokens(blockText(block)), 0) : 0
}

/** One part of a helper's brief and what it costs. */
export interface BriefSection { title: string; tokens: number }

const MAX_SECTIONS = 24
const MAX_TITLE = 80
const HEADING = /^(.{1,200}?)[:：]\s*$/u

/**
 * The parts of a helper's brief, as the brief itself divides them: it is written in paragraphs, and a paragraph whose first line ends in a colon opens a new part with that line as its
 * title. Text before the first heading is the part called with an empty title. Sizes are estimated.
 */
export function briefSections(prompt: string): BriefSection[] {
  const parts: { title: string; text: string[] }[] = []
  for (const block of prompt.split(/\n{2,}/)) {
    if (block.trim() === '') continue
    const heading = HEADING.exec(block.split('\n')[0]!)
    if (heading !== null || parts.length === 0) parts.push({ title: heading === null ? '' : heading[1]!.trim().slice(0, MAX_TITLE), text: [block] })
    else parts[parts.length - 1]!.text.push(block)
  }
  return parts.slice(0, MAX_SECTIONS).map(part => ({ title: part.title, tokens: estimateTokens(part.text.join('\n\n')) }))
}
