import { partsText, type OpeningPart } from '../../shared/opening.ts'
import { noAt } from '../decisions/route.ts'
import { norm, trOf, type ImportContext } from './run.ts'

/** A character an opening may give lines to. */
export interface Speaker { id: string; name: string; aliases: readonly string[] }

export interface ShapedOpening {
  /** The words of the opening, whichever form it takes. */
  text: string
  /** Set when characters speak in it; absent when it is pure narration, which stays plain text. */
  parts?: OpeningPart[]
  /** Why the opening was kept as plain text although a model was asked. */
  note?: string
}

const SCHEMA = {
  type: 'object',
  properties: { parts: { type: 'array', items: { type: 'object', properties: { kind: { type: 'string', enum: ['narration', 'speech'] }, speaker: { type: 'string' }, text: { type: 'string' } }, required: ['kind', 'speaker', 'text'], additionalProperties: false } } },
  required: ['parts'],
  additionalProperties: false,
} as const
// `kind` comes first in the alphabet, and a constrained reply writes its keys in that order: the part is classified before its speaker and words are chosen

const MAX_SHOWN = 6000
const QUOTES = /["'“”‘’「」『』«»„‟*_]/gu

/** The letters of a passage with quotation marks, emphasis marks, labels that name a speaker and all spacing taken out: what must be the same before and after splitting. */
export function lettersOf(text: string, speakers: readonly Speaker[] = []): string {
  let rest = text
  for (const name of speakers.flatMap(speaker => [speaker.name, ...speaker.aliases])) rest = rest.replace(new RegExp(`(^|\\n)\\s*${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*[:：]`, 'gu'), '$1')
  return rest.replace(QUOTES, '').replace(/\s+/gu, '')
}

/** Why an answer is not the passage split into parts; nothing when it is. */
export function splitProblem(source: string, parts: readonly OpeningPart[], speakers: readonly Speaker[]): string | undefined {
  if (parts.length === 0) return 'the answer has no parts'
  const wanted = lettersOf(source, speakers)
  const given = lettersOf(partsText(parts))
  if (wanted === given) return undefined
  let same = 0
  while (same < wanted.length && same < given.length && wanted[same] === given[same]) same += 1
  const around = (text: string): string => `“${text.slice(Math.max(0, same - 8), same + 24)}”`
  return `the parts do not hold exactly the words of the passage, in order: they agree up to ${around(wanted)} and then the passage goes on with “${wanted.slice(same, same + 24)}” where your parts have “${given.slice(same, same + 24)}”. Keep every sentence, narration between spoken lines included; change none, add none`
}

/** The speaker a name (or id) names; the player's character and unknown names are nobody, so the part is narration. */
function speakerOf(name: string, speakers: readonly Speaker[], player: string | undefined): Speaker | undefined {
  const key = norm(name)
  if (key === '') return undefined
  const found = speakers.find(speaker => speaker.id !== player && [speaker.id, speaker.name, ...speaker.aliases].some(label => norm(label) === key))
  return found
}

/** The parts an answer describes, with a speaker that is not in the cast made narration. */
export function partsOf(answer: { parts?: unknown }, speakers: readonly Speaker[], player: string | undefined): OpeningPart[] {
  const list = Array.isArray(answer.parts) ? answer.parts : []
  const parts: OpeningPart[] = []
  for (const entry of list) {
    if (typeof entry !== 'object' || entry === null) continue
    const body = entry as Record<string, unknown>
    const text = typeof body['text'] === 'string' ? tidyQuotes(body['text']) : ''
    if (text === '') continue
    // only a part the model calls speech can have a speaker: a narration sentence that merely names someone is not theirs
    const speaker = (body['kind'] ?? body['type']) === 'narration' ? undefined : speakerOf(typeof body['speaker'] === 'string' ? body['speaker'] : '', speakers, player)
    parts.push(speaker === undefined ? { type: 'narration', text } : { type: 'utterance', character: speaker.id, text })
  }
  return parts
}

const PAIRS: readonly (readonly [string, string])[] = [['“', '”'], ['‘', '’'], ['「', '」'], ['『', '』'], ['«', '»'], ['„', '“']]
const count = (text: string, mark: string): number => text.split(mark).length - 1

/**
 * A part's words without the quotation marks that belong to its surroundings: the marks around a whole quoted line, and a mark left at an edge by a cut that fell inside a quotation
 * (an opening mark with no closing one, a closing mark with no opening one). A balanced quotation inside the words stays.
 */
export function tidyQuotes(text: string): string {
  let result = text.trim()
  for (const [open, close] of [...PAIRS, ['"', '"'] as const]) {
    const inside = result.slice(1, -1)
    if (result.length > 1 && result.startsWith(open) && result.endsWith(close) && !inside.includes(open) && !inside.includes(close)) result = inside.trim()
  }
  result = result.replace(/^[”’」』»\s]+/u, '').replace(/[“‘「『«„\s]+$/u, '')
  for (const [open, close] of PAIRS) {
    if (result.startsWith(open) && count(result, open) > count(result, close)) result = result.slice(1).trim()
    if (result.endsWith(close) && count(result, close) > count(result, open)) result = result.slice(0, -1).trim()
  }
  if (count(result, '"') % 2 === 1) result = (result.startsWith('"') ? result.slice(1) : result.endsWith('"') ? result.slice(0, -1) : result).trim()
  return result
}

/** A stretch of the passage without the spacing and the quotation marks at its ends: an opening quote belongs to the line after it, a closing one to the line before. */
const unquoted = (text: string): string => text.replace(/^[\s"“”‘’「」『』«»„‟]+|[\s"“”‘’「」『』«»„‟]+$/gu, '')

/**
 * Puts back, as narration, the words of the passage that no part holds (a sentence between two spoken lines that the model skipped), when every part can be found in the passage in order.
 * Nothing is invented: a part that is not in the passage as written leaves the answer as it is, for the check to refuse.
 */
export function mendParts(source: string, parts: readonly OpeningPart[], speakers: readonly Speaker[]): OpeningPart[] {
  const mended: OpeningPart[] = []
  let at = 0
  for (const part of parts) {
    const found = source.indexOf(part.text, at)
    if (found < 0) return [...parts]
    const gap = unquoted(source.slice(at, found))
    if (lettersOf(gap, speakers) !== '') mended.push({ type: 'narration', text: gap })
    mended.push(part)
    at = found + part.text.length
  }
  const tail = unquoted(source.slice(at))
  if (lettersOf(tail, speakers) !== '') mended.push({ type: 'narration', text: tail })
  return mended
}

/**
 * Decides whether an opening is pure narration (kept as plain text) or has characters speaking (split into parts), and splits it. With a decision model the closed question
 * "does anyone speak" is asked first and a sure answer settles it; otherwise, or when it is unsure, the language model answers both in one reply. With no model the
 * opening stays as it is. A split that does not hold exactly the passage's words is refused, and the opening then stays plain with a note: no text is lost or invented.
 */
export async function shapeOpening(ctx: ImportContext, passage: string, speakers: readonly Speaker[], player?: string): Promise<ShapedOpening> {
  const plain: ShapedOpening = { text: passage }
  if (ctx.noModel === true || passage.trim() === '' || speakers.every(speaker => speaker.id === player)) return plain
  if (ctx.decide !== undefined) {
    try {
      const probabilities = await ctx.decide({ passage: passage.slice(0, MAX_SHOWN) }, [{ key: 'speech', instructions: ctx.text('roleplay/decide-opening') }])
      const speech = probabilities.get('speech') ?? 0.5
      const confidence = ctx.confidence ?? 0.7
      // a sure no keeps the plain text; a yes or an unsure answer goes to the language model, which splits it or finds nothing to split
      if (speech <= noAt(confidence)) return plain
    } catch {
      // the decision model could not be used: the language model decides
    }
  }
  try {
    const tr = trOf(ctx)
    const cast = speakers.filter(speaker => speaker.id !== player).map(speaker => `- ${speaker.name}`).join('\n')
    const answer = await ctx.run<{ parts: unknown }>({
      persona: ctx.text('import/opening'),
      maxTokens: Math.min(8000, Math.max(1500, Math.ceil(passage.length / 2) + 600)),
      prompt: `${tr('Cast:')}\n${cast}\n\n${tr('Passage:')}\n${passage}`,
      result: SCHEMA as never,
      check: value => splitProblem(passage, mendParts(passage, partsOf(value, speakers, player), speakers), speakers),
    })
    const parts = mendParts(passage, partsOf(answer, speakers, player), speakers)
    return parts.some(part => part.type === 'utterance') ? { text: partsText(parts), parts } : plain
  } catch (error) {
    return { ...plain, note: `the opening could not be split into parts, so it is kept as plain text: ${error instanceof Error ? error.message : String(error)}` }
  }
}
