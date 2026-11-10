import type { NormalizedCard } from '../../shared/import-card.ts'
import { MARKUP } from './dialect.ts'

/** What a card's message holds apart from the story: the status bars and panels a chat tool shows under a reply. */
export interface Split {
  prose: string
  panels: string[]
}

const FENCE = /```[^\n]*\n[\s\S]*?```/g
const TAG = /<(\/?)([\p{L}][\p{L}\p{N}_-]*)(?=[\s>/])[^>]*>/gu
const BLOCKS = new Set(['div', 'table', 'details', 'pre', 'center', 'section', 'aside', 'fieldset'])
const SEPARATORS = /\s[|｜│]\s|[|｜│]\s*\S+\s*[|｜│]/
const HEADER = /(?:^|\n)[ \t]*(?:【[^】\n]{1,30}】|\[[^\]\n]{1,30}\]|#+[ \t]*[^\n]{1,30})[ \t]*\n?\s*$/
const MAX_HTML_TEXT_CHARS = 600
const MAX_CUSTOM_CHARS = 4000
/** A block of tags of a card's own invention (not markup) counts as a panel from this many tags: two or three tags are a form of address or an aside, a layout is more. */
const MIN_CUSTOM_TAGS = 6
const MAX_PANELS = 6

const collapse = (text: string): string => text.replace(/\n{3,}/g, '\n\n').trim()
const plain = (html: string): string => html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()

interface Block {
  from: number
  to: number
  /** Whether it holds tags that are not markup: names the card made up. */
  custom: boolean
  tags: number
}

/** The outermost elements of block markup and of invented tags in a text, balanced by their own names, with neighbours that only whitespace separates joined into one. */
function tagBlocks(text: string): Block[] {
  const found: Block[] = []
  const open: string[] = []
  let current: Block = { from: 0, to: 0, custom: false, tags: 0 }
  const closed = new Set([...text.matchAll(TAG)].filter(match => match[1] === '/').map(match => match[2]!.toLowerCase()))
  for (const match of text.matchAll(TAG)) {
    const name = match[2]!.toLowerCase()
    const custom = !MARKUP.has(name)
    if (!custom && !BLOCKS.has(name)) continue
    // an opening tag nothing closes (the `<START>` that separates example messages) is not a block
    if (match[1] === '' && !closed.has(name)) continue
    if (match[1] === '') {
      if (open.length === 0) current = { from: match.index, to: 0, custom: false, tags: 0 }
      open.push(name)
      current.tags += 1
      current.custom ||= custom
    } else if (open.includes(name)) {
      while (open.pop() !== name) { /* a close tag ends what it names and whatever was left open inside */ }
      current.tags += 1
      if (open.length === 0) { current.to = match.index + match[0].length; found.push(current) }
    }
  }
  const joined: Block[] = []
  for (const block of found) {
    const last = joined.at(-1)
    if (last !== undefined && text.slice(last.to, block.from).trim() === '') { last.to = block.to; last.custom ||= block.custom; last.tags += block.tags } else joined.push({ ...block })
  }
  return joined.map(block => {
    const header = block.custom ? HEADER.exec(text.slice(0, block.from)) : null
    return header === null ? block : { ...block, from: header.index + (header[0].startsWith('\n') ? 1 : 0) }
  })
}

const statusLine = (line: string): boolean => SEPARATORS.test(line) && /\d/.test(line)

/** An update call of a state-tracking framework: a block that holds one is a panel however few tags it has. */
const CALL = /\b_\.\w+\(|\bstat_data\b|\bJSONPatch\b/

/** The text before a removed panel without its last line when that line only introduces the panel ("end every reply with this:"). */
const withoutLeadIn = (before: string): string => before.replace(/(?:^|\n)[^\n]*[:：][ \t]*\n?\s*$/, '\n')

function fencesWithoutLeadIn(text: string, panels: string[]): string {
  let out = ''
  let last = 0
  for (const match of text.matchAll(FENCE)) {
    panels.push(match[0].replace(/^```[^\n]*\n|```$/g, '').trim())
    out += `${withoutLeadIn(text.slice(last, match.index))}\n\n`
    last = match.index + match[0].length
  }
  return out + text.slice(last)
}

export interface SplitOptions {
  /** The text tells a model what to do (a rule, a narration): the line that introduces a removed panel ("in this format:") goes with it. */
  leadIn?: boolean
  /** The text is nothing but the panel (a game master's narration): take it out even though no story text is left. */
  alone?: boolean
}

/**
 * Takes the status bars out of a message: fenced code blocks, blocks of tags of the card's own invention (a layout of nested tags, which names may be in any language), short blocks
 * of markup that carry numbers (when the message has story text besides them: a message wrapped whole in a block is only styled), and closing lines of values set apart by bars.
 * What is left is the story; the panels are what the card shows its state with.
 */
export function splitPanels(text: string, options: SplitOptions = {}): Split {
  const panels: string[] = []
  let rest = options.leadIn === true ? fencesWithoutLeadIn(text, panels) : text.replace(FENCE, block => { panels.push(block.replace(/^```[^\n]*\n|```$/g, '').trim()); return '\n\n' })
  const blocks = tagBlocks(rest)
  const outside = blocks.reduceRight((left, { from, to }) => left.slice(0, from) + left.slice(to), rest)
  if (blocks.length > 0 && (options.alone === true || plain(outside) !== '')) {
    for (const block of [...blocks].reverse()) {
      const body = rest.slice(block.from, block.to)
      const panel = block.custom ? (block.tags >= MIN_CUSTOM_TAGS || CALL.test(body)) && body.length <= MAX_CUSTOM_CHARS : plain(body).length <= MAX_HTML_TEXT_CHARS && /\d/.test(body)
      if (!panel) continue
      panels.unshift(body.trim())
      rest = (options.leadIn === true ? withoutLeadIn(rest.slice(0, block.from)) : rest.slice(0, block.from)) + '\n\n' + rest.slice(block.to)
    }
  }
  const paragraphs = collapse(rest).split(/\n{2,}/)
  while (paragraphs.length > 1 && paragraphs.at(-1)!.split('\n').every(statusLine)) panels.push(paragraphs.pop()!.trim())
  return { prose: collapse(paragraphs.join('\n\n')), panels: panels.filter(panel => panel !== '') }
}

/** The distinct panels in a card's own messages (openings and examples): they show which values it keeps and where they start. */
export function panelsOfCard(card: NormalizedCard): string[] {
  const texts = [card.firstMessage, ...card.alternateGreetings, card.messageExample]
  return [...new Set(texts.flatMap(text => splitPanels(text).panels))].filter(panel => panel.length <= MAX_CUSTOM_CHARS).slice(0, MAX_PANELS)
}

/** The sentences of one line; a full stop inside a word or a call (`_.set(`) does not end one. */
const sentencesOf = (line: string): string[] => line.match(/(?:[^.!?。！？]|[.!?](?!\s|$))+(?:[.!?]+(?=\s|$)|[。！？]+|$)\s*/gu) ?? [line]

const MIN_LEFT_OUT_WORDS = 3
const ECHO_SHARE = 0.6
/** A short sentence right after a dropped one ("Never skip it.") has nothing left to refer to. */
const MAX_TAIL_WORDS = 4

function wordsOf(text: string): Set<string> {
  const words = new Set<string>()
  for (const word of text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []) {
    if (/[㐀-鿿]/.test(word)) for (let index = 0; index < word.length - 1; index += 1) words.add(word.slice(index, index + 2))
    else if (word.length >= 3) words.add(word)
  }
  return words
}

/**
 * The sentences of a prose prompt that repeat something the same answer lists as left out. A model that is told to drop an instruction about the shape of the reply (a status bar after
 * every message) tends to list it and keep it in the same breath; what it listed is not carried.
 */
export function withoutLeftOut(prose: string, leftOut: readonly string[]): string {
  const dropped = leftOut.map(wordsOf).filter(words => words.size >= MIN_LEFT_OUT_WORDS)
  if (dropped.length === 0) return prose
  const echoes = (sentence: string): boolean => {
    const words = wordsOf(sentence)
    return dropped.some(left => [...left].filter(word => words.has(word)).length >= left.size * ECHO_SHARE)
  }
  const kept = (line: string): string => {
    let after = false
    return sentencesOf(line).filter((sentence) => {
      const echo = echoes(sentence)
      const tail = after && sentence.trim().split(/\s+/).length <= MAX_TAIL_WORDS
      after = echo
      return !echo && !tail
    }).join('').trim()
  }
  return prose.split('\n').map(kept).filter(line => line !== '').join('\n')
}

const OUTPUT_MARKUP = /<\/?[\p{L}][\p{L}\p{N}_-]*>|```|\b_\.\w+\(|\bstat_data\b|\{\{(?!\s*(?:user|char|bot)\s*\}\})[^{}]+\}\}/u

/** A text that is mostly a panel is a format specification, not a rule or a fact: it goes whole. */
const PANEL_SHARE = 0.5

/** A standing rule without the panel it demands, the sentences that tell the game master to print markup, a code block or an update call after a reply, and the rule itself when the panel was most of it: the story shows its tracked values itself. */
export function withoutOutputMarkup(passage: string): string {
  const { prose, panels } = splitPanels(passage, { alone: true, leadIn: true })
  if (panels.length > 0 && prose.length < passage.length * PANEL_SHARE) return ''
  return prose.split('\n').map(line => sentencesOf(line).filter(sentence => !OUTPUT_MARKUP.test(sentence)).join('').trim()).filter(line => line !== '').join('\n')
}

const BARRED = /(?:\s[|｜│]\s[^|｜│\n]+){2,}/

/** The first status bar, panel or print-this-markup directive in a text, as written, or nothing: what a world should show with its tracked values rather than carry as text. */
export function findPanel(text: string): string | undefined {
  const panel = splitPanels(text, { alone: true }).panels[0]
  if (panel !== undefined) return panel
  for (const line of text.split('\n')) for (const sentence of sentencesOf(line)) if (OUTPUT_MARKUP.test(sentence) || (BARRED.test(sentence) && /\d/.test(sentence))) return sentence.trim()
  return undefined
}
