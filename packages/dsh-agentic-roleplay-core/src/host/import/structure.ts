import type { NormalizedCard } from '../../shared/import-card.ts'
import type { ImportChoices } from '../../shared/import-card.ts'
import { asWritten, characterDocument, emptyExtracted, inert, loreDocuments, addLore, type Extracted } from './extract.ts'
import { cleanText, type SourceItem } from './items.ts'
import { slug, uniqueKey } from './run.ts'
import type { Classified, Roster } from './survey.ts'

/** The most example lines the character keeps. */
const MAX_EXAMPLES = 8
/** The summary is the start of the description: a sentence or two. */
const SUMMARY_CHARS = 280

/** The lines of the example messages that the character speaks, as written; the markers of the tool that wrote them are taken out. */
function exampleLines(text: string, name: string): string[] {
  const lines = cleanText(text, name).split('\n').map(line => line.trim()).filter(line => line !== '')
  const speaker = /^([^:\n]{1,100}):\s*(.*)$/
  if (!lines.some(line => speaker.test(line))) return lines.slice(0, MAX_EXAMPLES)
  const names = new Set([name, name.split(/\s+/)[0] ?? ''].map(part => part.toLocaleLowerCase()))
  return lines.flatMap(line => {
    const match = speaker.exec(line)
    if (match?.[1] === undefined || !names.has(match[1].trim().toLocaleLowerCase())) return []
    const utterance = match[2]?.trim()
    return utterance === undefined || utterance === '' ? [] : [utterance]
  }).slice(0, MAX_EXAMPLES)
}

/**
 * What a card holds, laid out without a model: the card's own character from its description, personality and examples, its lorebook entries as lore in its own words (for the game master only,
 * as nothing has read what they say), and its instructions as the narration style, word for word. No place, faction, thing or other person is found: those take a reader.
 */
export function structureOnly(card: NormalizedCard, items: readonly SourceItem[], _choices: ImportChoices): { classified: Classified; roster: Roster; extracted: Extracted } {
  const taken = new Set<string>()
  const key = uniqueKey(slug(card.name, 'character'), taken)
  const roster: Roster = [{ kind: 'character', key, name: card.name, aliases: [], player: false }]
  const target = [{ name: card.name, kind: 'character' as const }]
  const classified: Classified = {}
  for (const item of items) {
    if (item.id.startsWith('field:description') || item.id.startsWith('field:personality')) classified[item.id] = { roles: ['character'], targets: target }
    else if (item.id.startsWith('field:example')) classified[item.id] = { roles: ['speech'], targets: target }
    else if (item.id.startsWith('field:')) classified[item.id] = { roles: ['scenario'], targets: [] }
    else classified[item.id] = { roles: ['world'], targets: [] }
  }
  const extracted = emptyExtracted()
  const description = cleanText(card.description, card.name)
  const built = characterDocument(roster[0]!, {
    tier: 'principal', kind: 'person', summary: description.slice(0, SUMMARY_CHARS).trim(), personality: cleanText(card.personality, card.name), background: description,
    speech: { style: '', examples: exampleLines(card.messageExample, card.name) },
  }, roster)
  extracted.characters.push(built.document)
  extracted.notes.push(...built.notes)
  for (const item of items.filter(entry => entry.id.startsWith('entry:'))) {
    for (const entry of loreDocuments(asWritten(item), roster, taken)) addLore(extracted.lore, { ...entry.document, scope: 'listed' })
  }
  const instructions = [card.systemPrompt, card.postHistoryInstructions].map(text => cleanText(text, card.name)).filter(text => text !== '')
  if (instructions.length > 0) extracted.prompts.push({ id: 'roleplay/style', text: inert(instructions.join('\n\n')) })
  extracted.notes.push('imported without a model: only the card\'s own character, its lorebook and its instructions were carried over')
  return { classified, roster, extracted }
}
