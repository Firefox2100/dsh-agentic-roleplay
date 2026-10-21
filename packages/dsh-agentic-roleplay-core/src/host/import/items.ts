import type { ImportChoices, NormalizedCard } from '../../shared/import-card.ts'
import { openingText } from './store.ts'

/** One piece of a card that is read on its own: a field, the chosen opening, or a lorebook entry (or a part of a long one). */
export interface SourceItem {
  /** `field:description`, `entry:3`, `entry:3#2`: names the piece wherever it is used. */
  id: string
  /** What it is, for the person reading a report. */
  label: string
  /** The title of a lorebook entry. */
  title: string
  keys: string[]
  text: string
}

/** The longest a piece goes into one call. Longer entries are cut into parts at the end of a paragraph. */
export const MAX_ITEM_CHARS = 5000

/** What stands for the player in the text a model reads. The card's own `{{user}}` cannot: the system prompt of an agent reads double braces as a variable of its own. */
export const PLAYER_MARKER = '[PLAYER]'

/** Macros and markup of the tool that wrote the card, taken out of text a model reads: the card's own name stands for `{{char}}`; the player becomes the marker `[PLAYER]`. */
export function cleanText(text: string, cardName: string): string {
  return text
    .replace(/\r\n?/g, '\n')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\{\{\s*\/\/[\s\S]*?\}\}/g, '')
    .replace(/\{\{\s*char\s*\}\}|<char>|<bot>/gi, cardName)
    .replace(/\{\{\s*user\s*\}\}|<user>/gi, PLAYER_MARKER)
    .split('\n').filter(line => line.trim().toUpperCase() !== '<START>').join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/** Cuts a text into parts of at most `max` characters, at the end of a paragraph, or of a line, or anywhere when there is no choice. */
export function partsOf(text: string, max: number = MAX_ITEM_CHARS): string[] {
  const parts: string[] = []
  let rest = text
  while (rest.length > max) {
    const window = rest.slice(0, max)
    const cut = Math.max(window.lastIndexOf('\n\n'), window.lastIndexOf('\n'), window.lastIndexOf('。'), window.lastIndexOf('. '))
    const at = cut > max / 2 ? cut + 1 : max
    parts.push(rest.slice(0, at).trim())
    rest = rest.slice(at).trim()
  }
  if (rest !== '') parts.push(rest)
  return parts
}

function itemsOf(id: string, label: string, title: string, keys: string[], raw: string, cardName: string): SourceItem[] {
  const text = cleanText(raw, cardName)
  if (text === '') return []
  const parts = partsOf(text)
  return parts.map((part, index) => ({ id: parts.length === 1 ? id : `${id}#${index + 1}`, label: parts.length === 1 ? label : `${label} (part ${index + 1})`, title, keys, text: part }))
}

/**
 * The pieces of a card that are read for what the world is made of: what describes the characters and the setting, the opening the person chose, and the lorebook
 * entries they left on. The instructions to the narrator (system prompt, post-history instructions) and the creator's notes are not among them: they are not part of the world.
 */
export function itemise(card: NormalizedCard, choices: ImportChoices): SourceItem[] {
  const name = card.name
  const opening = openingText(card, choices.opening)
  const off = new Set(choices.disabledEntries)
  return [
    ...itemsOf('field:description', 'description', '', [], card.description, name),
    ...itemsOf('field:personality', 'personality', '', [], card.personality, name),
    ...itemsOf('field:scenario', 'scenario', '', [], card.scenario, name),
    ...itemsOf('field:example', 'example messages', '', [], card.messageExample, name),
    ...(opening === undefined ? [] : itemsOf('field:opening', 'opening', '', [], opening, name)),
    ...(card.book?.entries ?? []).filter(entry => !off.has(entry.id)).flatMap(entry => itemsOf(entry.id, entry.title === '' ? entry.id : `entry “${entry.title}”`, entry.title, entry.keys, entry.content, name)),
  ]
}

/** The word a text uses for the player: the player's character when it is named, otherwise a plain word in the text's own script. */
export function playerWord(text: string, name?: string): string {
  if (name !== undefined) return name
  return /[㐀-鿿]/.test(text) ? '玩家' : 'the player'
}

/** The text with the player marker replaced. */
export function withPlayer(text: string, name?: string): string {
  return text.replace(/\[PLAYER\]|\{\{\s*user\s*\}\}/g, playerWord(text, name))
}
