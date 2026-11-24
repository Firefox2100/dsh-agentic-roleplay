import type { Session } from '@dsh-agentic-roleplay/state'
import type { Summary, StoryEvent } from 'dsh-roleplay-model'
import type { ChatSettings } from '../../shared/settings.ts'

/** Writes a passage of the story's account. It is given the material and how long to be, and returns the prose. */
export interface Chronicler {
  write(request: { task: string; material: string; words: number }, signal: AbortSignal): Promise<string>
}

type Story = Pick<Session, 'events' | 'summaries' | 'characters' | 'threads'>

const CJK = /\p{Script=Han}|\p{Script=Hiragana}|\p{Script=Katakana}|\p{Script=Hangul}/gu

/** A rough size of a text in tokens: scripts written without spaces are denser than the rest. */
export function estimateTokens(text: string): number {
  const dense = (text.match(CJK) ?? []).length
  return Math.ceil(dense * 0.9 + (text.length - dense) / 3.8)
}

const WORDS_PER_TOKEN = 0.7

/** The length of a text in the units the account is counted in: words, and each character of a script written without spaces. */
const unitsOf = (text: string): number => (text.match(CJK) ?? []).length + text.replace(CJK, ' ').split(/\s+/).filter(word => word !== '').length

/** A passage is never asked to be longer than its material supports: a limit that is a ceiling of the chat's budget alone is filled with atmosphere. */
const fitted = (budget: number, body: string): number => Math.max(40, Math.min(budget, Math.round(unitsOf(body) * 0.7)))

const eventLine = (event: StoryEvent, names: ReadonlyMap<number, string>): string => {
  const who = event.involves.map(id => names.get(id)).filter(name => name !== undefined).join(', ')
  return `- [turn ${event.turn}] (importance ${event.importance}) ${event.text}${who === '' ? '' : ` — involves ${who}`}`
}

/** The events themselves as the account, in order: when they exceed the size, the least important go first. Nothing is written that the keeper did not record. */
export function accountFromEvents(events: readonly StoryEvent[], units: number): string {
  const kept = [...events]
  let total = kept.reduce((sum, event) => sum + unitsOf(event.text), 0)
  while (total > units && kept.length > 1) {
    const least = kept.reduce((worst, event, index) => (event.importance < kept[worst]!.importance || (event.importance === kept[worst]!.importance && event.turn < kept[worst]!.turn) ? index : worst), 0)
    total -= unitsOf(kept[least]!.text)
    kept.splice(least, 1)
  }
  return kept.map(event => event.text.trim()).reduce((text, line) => (text === '' ? line : `${text}${CJK.test(line.slice(0, 1)) ? '' : ' '}${line}`), '')
}

function material(sections: readonly [string, string][]): string {
  return sections.filter(([, body]) => body.trim() !== '').map(([title, body]) => `## ${title}\n${body.trim()}`).join('\n\n')
}

/**
 * Brings the summaries up to date with the turns that are leaving the conversation.
 * A digest is written for the new turns, from the events recorded for them and what the
 * player did. When the short-term digests are too long their oldest move into a chapter
 * of the long-term account, and when the chapters are too long the oldest are condensed
 * into one. Every step reads the events as the ground truth, so the account does not
 * drift the way a summary of a summary does.
 */
export async function foldSummaries(input: {
  story: Story
  settings: ChatSettings['context']
  /** The last turn that is leaving the conversation. */
  uptoTurn: number
  /** What the player did in the turns leaving, in order. */
  playerInputs: string
  /** What happened, as the conversation told it; used where the events do not cover the turns. */
  transcript: string
  chronicler: Chronicler
  /** `events`: the accounts are made of the recorded events themselves and the chronicler is not asked where the events cover the turns. */
  account?: 'written' | 'events'
  /** The instruction texts, in the language of the chat. */
  text: (id: 'digest' | 'chapter' | 'condense', variables: Record<string, string | number>) => string
  signal: AbortSignal
}): Promise<void> {
  const { story, settings, chronicler, signal, text: instruction } = input
  const fromRecords = input.account === 'events'
  const budget = (tokens: number): number => Math.round(tokens * WORDS_PER_TOKEN)
  const names = new Map(story.characters.list().map(character => [character.id, character.name]))
  const known = story.summaries.list()
  const coveredTo = known.reduce((latest, summary) => Math.max(latest, summary.toTurn), 0)

  const add = (level: 'digest' | 'chapter', fromTurn: number, toTurn: number, text: string): void => { story.summaries.add({ level, fromTurn, toTurn, text: text.trim() }) }

  if (input.uptoTurn > coveredTo) {
    const events = story.events.list({ fromTurn: coveredTo + 1, toTurn: input.uptoTurn })
    const turns = new Set(events.map(event => event.turn))
    const complete = [...Array(input.uptoTurn - coveredTo).keys()].every(offset => turns.has(coveredTo + 1 + offset))
    if (fromRecords && complete) {
      add('digest', coveredTo + 1, input.uptoTurn, accountFromEvents(events, budget(Math.min(600, settings.shortTermTokens / 2))))
    } else {
      const body = material([
        ['Events (authoritative)', events.map(event => eventLine(event, names)).join('\n')],
        ['What the player did', input.playerInputs],
        [complete ? '' : 'The conversation as it was told (use it for what the events do not cover)', complete ? '' : input.transcript],
      ])
      const words = fitted(budget(Math.min(600, settings.shortTermTokens / 2)), body)
      add('digest', coveredTo + 1, input.uptoTurn, await chronicler.write({ task: instruction('digest', { from: coveredTo + 1, to: input.uptoTurn, words }), material: body, words }, signal))
    }
  }

  const size = (summaries: readonly Summary[]): number => summaries.reduce((total, summary) => total + estimateTokens(summary.text), 0)

  let digests = story.summaries.list('digest')
  if (size(digests) > settings.shortTermTokens && digests.length > 1) {
    const absorbed: Summary[] = []
    let rest = digests
    while (rest.length > 1 && size(rest) > settings.shortTermTokens * 0.7) {
      absorbed.push(rest[0]!)
      rest = rest.slice(1)
    }
    const fromTurn = absorbed[0]!.fromTurn
    const toTurn = absorbed.at(-1)!.toTurn
    const important = story.events.list({ fromTurn, toTurn, minImportance: 3 })
    const ceiling = budget(Math.max(60, Math.min(400, settings.longTermTokens / 4)))
    if (fromRecords && important.length > 0) {
      add('chapter', fromTurn, toTurn, accountFromEvents(important, ceiling))
    } else {
      const body = material([
        ['Digests to condense', absorbed.map(summary => summary.text).join('\n\n')],
        ['Important events of these turns (authoritative)', important.map(event => eventLine(event, names)).join('\n')],
      ])
      const words = fitted(ceiling, body)
      add('chapter', fromTurn, toTurn, await chronicler.write({ task: instruction('chapter', { from: fromTurn, to: toTurn, words }), material: body, words }, signal))
    }
    story.summaries.remove(absorbed.map(summary => summary.id))
    digests = story.summaries.list('digest')
  }

  let chapters = story.summaries.list('chapter')
  while (size(chapters) > settings.longTermTokens && chapters.length > 1) {
    const [older, newer] = chapters as [Summary, Summary, ...Summary[]]
    const major = story.events.list({ fromTurn: older.fromTurn, toTurn: newer.toTurn, minImportance: 4 })
    const ceiling = budget(Math.max(60, settings.longTermTokens / 3))
    if (fromRecords && major.length > 0) {
      add('chapter', older.fromTurn, newer.toTurn, accountFromEvents(major, ceiling))
    } else {
      const body = material([
        ['Chapters', `${older.text}\n\n${newer.text}`],
        ['Important events of these turns (authoritative; correct the chapters where they disagree)', major.map(event => eventLine(event, names)).join('\n')],
      ])
      const words = fitted(ceiling, body)
      add('chapter', older.fromTurn, newer.toTurn, await chronicler.write({ task: instruction('condense', { from: older.fromTurn, to: newer.toTurn, words }), material: body, words }, signal))
    }
    story.summaries.remove([older.id, newer.id])
    chapters = story.summaries.list('chapter')
  }
}

const span = (summary: Summary): string => (summary.fromTurn === summary.toTurn ? `Turn ${summary.fromTurn}` : `Turns ${summary.fromTurn}-${summary.toTurn}`)

/** The account the game master reads at the head of the conversation: what happened long ago, then what happened recently. */
export function composeSummary(story: Pick<Session, 'summaries'>): string {
  const chapters = story.summaries.list('chapter')
  const digests = story.summaries.list('digest')
  const parts = [
    chapters.length === 0 ? '' : `Story so far (long term):\n${chapters.map(summary => `${span(summary)}: ${summary.text}`).join('\n\n')}`,
    digests.length === 0 ? '' : `Recently (short term):\n${digests.map(summary => `${span(summary)}: ${summary.text}`).join('\n\n')}`,
  ]
  return parts.filter(part => part !== '').join('\n\n')
}
