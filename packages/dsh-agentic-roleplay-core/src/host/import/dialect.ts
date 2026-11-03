import { languageOf, translator } from 'dsh-roleplay-model'
import type { CardDialect, NormalizedCard } from '../../shared/import-card.ts'

const MAX_NAMES = 8
const PLAIN_MACROS = new Set(['user', 'char', 'bot'])
const MARKUP = new Set(['a', 'b', 'i', 'u', 's', 'p', 'br', 'hr', 'em', 'strong', 'span', 'div', 'code', 'pre', 'center', 'small', 'img', 'ul', 'ol', 'li', 'blockquote', 'details', 'summary', 'font', 'sub', 'sup', 'h1', 'h2', 'h3', 'table', 'tr', 'td', 'th'])
const MACRO = /\{\{\s*([\p{L}_][\p{L}\p{N}_]*)/gu
const BLOCK = /<([\p{L}][\p{L}\p{N}_-]{1,30})(?:\s[^>]*)?>[\s\S]*?<\/\1\s*>/gu

function textsOf(card: NormalizedCard): string[] {
  return [
    card.description, card.personality, card.scenario, card.firstMessage, ...card.alternateGreetings, card.messageExample, card.systemPrompt, card.postHistoryInstructions,
    ...(card.book?.entries ?? []).map(entry => entry.content),
  ]
}

/** The distinct values of a pattern's first group over some texts, in the order met, lowercased and cut to a few. */
function namesIn(texts: string[], pattern: RegExp, skip: (name: string) => boolean): string[] {
  const found = new Set<string>()
  for (const text of texts) for (const match of text.matchAll(pattern)) {
    const name = match[1]!.toLowerCase()
    if (!skip(name)) found.add(name)
  }
  return [...found].slice(0, MAX_NAMES)
}

/** Reads the machinery of the source tool out of a card: macros, tag blocks and the scripts the reader counted. */
export function dialectOf(card: NormalizedCard): CardDialect {
  const texts = textsOf(card)
  return {
    macros: namesIn(texts, MACRO, name => PLAIN_MACROS.has(name)),
    tags: namesIn(texts, BLOCK, name => MARKUP.has(name)),
    regexScripts: card.ignored.regexScripts ?? 0,
    helperScripts: card.ignored.helperScripts ?? card.ignored.scripts - (card.ignored.regexScripts ?? 0),
  }
}

export const hasDialect = (dialect: CardDialect): boolean => dialect.macros.length > 0 || dialect.tags.length > 0 || dialect.regexScripts > 0 || dialect.helperScripts > 0

/** What the person is told about a card before the import starts: what it is, and which of its machinery is left out. */
export function sourceSummary(card: NormalizedCard, language?: string): string {
  const tr = translator(languageOf(language))
  const dialect = dialectOf(card)
  const lines = [tr('The source is a {format} card with {entries} lorebook entries and {greetings} alternate openings.', { format: card.sourceSpec === 'chara_card_v2' ? 'V2' : 'V3', entries: String(card.book?.entries.length ?? 0), greetings: String(card.alternateGreetings.length) })]
  const left = [
    ...dialect.regexScripts > 0 ? [tr('{count} regular expressions', { count: String(dialect.regexScripts) })] : [],
    ...dialect.helperScripts > 0 ? [tr('{count} helper scripts', { count: String(dialect.helperScripts) })] : [],
    ...dialect.macros.length > 0 ? [tr('macros ({names})', { names: dialect.macros.join(', ') })] : [],
    ...dialect.tags.length > 0 ? [tr('tag blocks ({names})', { names: dialect.tags.join(', ') })] : [],
  ]
  if (left.length > 0) lines.push(tr('Nothing runs them, so they are not carried: {parts}. Their effect is kept only where the card also says it in words.', { parts: left.join('; ') }))
  return lines.join(' ')
}
