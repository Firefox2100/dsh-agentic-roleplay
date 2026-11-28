import { createSessionStore, parseRecordsEdit, recordsEditSchema, type RecordsEdit } from '@dsh-agentic-roleplay/state'
import { describePrompt } from '../../src/host/orchestration/committer.ts'
import type { CommitEntry, CommitJob, TurnStore } from '../../src/host/orchestration/boundaries.ts'
import { shippedText } from '../../src/host/prompts/library.ts'
import { DEFAULT_SETTINGS } from '../../src/shared/settings.ts'
import type { Language } from './language.ts'
import { CAST, PLAYER, castName } from './attribution-cases.ts'
import type { ClaimsCase } from './claims-cases.ts'

export interface Problem {
  rule: 'unreadable' | 'missing-claim' | 'over-claimed' | 'missing-link' | 'wrong-sign' | 'decisive-from-talk' | 'status-set' | 'missing-question' | 'false-question' | 'missing-concealment'
  detail: string
}

const ROUND = { turn: 3, round: 1 }

/**
 * The story at the start of the case: the invented cast, what was recorded before the round (events and the claims made in them), and the round's own plain events as the engine writes them
 * when a round is decided, so the keeper links to events it can name by number.
 */
export function jobOf(made: ClaimsCase, language: Language): { job: CommitJob; persona: string; prompt: string; schema: unknown; roundEvents: number[]; priorClaims: number[]; session: ReturnType<typeof createSessionStore> } {
  const session = createSessionStore(':memory:', { id: `bench-${made.id}`, name: made.id, world: { id: 'bench', name: 'Bench' } })
  for (const key of CAST) {
    session.characters.add({ sourceId: key, name: castName(key, language), aliases: [], kind: 'person', tier: 'principal', role: key === PLAYER ? 'playable' : 'npc', control: key === PLAYER ? 'player' : 'agent', summary: '', personality: '', background: '', appearance: '', speech: { style: '', examples: [] } })
  }
  const room = session.locations.add({ sourceId: 'room', name: language === 'en' ? 'The parlor' : '客厅', description: '', features: [] })
  const away = session.locations.add({ sourceId: 'away', name: language === 'en' ? 'Elsewhere' : '别处', description: '', features: [] })
  for (const key of CAST) session.placements.place('character', session.characters.getBySourceId(key)!.id, { locationId: (made.present.includes(key) ? room : away).id })
  const perceived = (seen: readonly string[]) => seen.map(character => ({ character, mode: 'witnessed' as const }))
  const prior = made.prior(language)
  const priorIds = prior.events.map((event, index) => session.edit({ turn: 1 + Math.floor(index / 2), events: [{ turn: 1 + Math.floor(index / 2), round: 1 + (index % 2), text: event.text, importance: 3, involves: [...event.seen], perceivedBy: perceived(event.seen) }] }).eventIds[0]!)
  const priorClaims = prior.claims.map(claim => session.claims.add({ text: claim.text, byCharacterId: session.characters.getBySourceId(claim.by)!.id, assertedEventId: priorIds[claim.event - 1]!, createdTurn: 1 }).id)
  const entries = made.entries(language).map((entry): CommitEntry => ({ ...entry, name: castName(entry.character as (typeof CAST)[number], language), intent: entry.summary, commitment: 'medium', spoken: true }))
  const roundEvents = entries.map(entry => session.edit({ turn: ROUND.turn, events: [{ ...ROUND, text: entry.summary, importance: 3, involves: [entry.character], perceivedBy: perceived(made.present) }] }).eventIds[0]!)
  const settings = { ...DEFAULT_SETTINGS, prompts: { ...DEFAULT_SETTINGS.prompts, language } }
  const store = { story: session, cast: () => session.characters.list().map(character => ({ key: character.sourceId, character })), settings: () => settings, queryVector: async () => undefined } as unknown as TurnStore
  const job: CommitJob = { chat: 'bench', store, rounds: [{ ...ROUND, situation: made.situation(language), place: { key: 'room', name: language === 'en' ? 'The parlor' : '客厅' }, present: made.present.map(character => ({ character, place: 'room' })), entries }] }
  const name = language === 'en' ? 'English' : 'Chinese'
  return { job, persona: shippedText('roleplay/record-keeper', language, { language: name }), prompt: describePrompt(job, settings.memory), schema: recordsEditSchema({ characters: CAST }), roundEvents, priorClaims, session }
}

/** What the claims in the written records must not get wrong, held against the structured edit by ids and bearings, never by wording. */
export function scoreEdit(answer: unknown, made: ClaimsCase, roundEvents: readonly number[], priorClaims: readonly number[]): Problem[] {
  let edit: RecordsEdit
  try { edit = parseRecordsEdit(answer) } catch (error) { return [{ rule: 'unreadable', detail: error instanceof Error ? error.message : String(error) }] }
  const problems: Problem[] = []
  const claims = edit.claims ?? []
  const roundSet = new Set(roundEvents)
  const decisive = (as: string): boolean => as === 'confirms' || as === 'contradicts'
  for (const claim of claims) if (claim.status !== undefined) problems.push({ rule: 'status-set', detail: `a claim is written as ${claim.status}` })
  const against = priorClaims[0]
  const linksTo = (claim: number | undefined) => (edit.claimLinks ?? []).filter(link => link.claim === claim && roundSet.has(link.event))
  const expect = made.expect
  switch (expect.rule) {
    case 'claim-by':
      if (!claims.some(claim => claim.byCharacter === expect.who)) problems.push({ rule: 'missing-claim', detail: `no claim by ${expect.who}` })
      break
    case 'no-claims':
      if (claims.length > 0) problems.push({ rule: 'over-claimed', detail: claims.map(claim => claim.text).join(' | ') })
      break
    case 'link': {
      const found = linksTo(against)
      for (const link of found) if (expect.forbidden.includes(link.as)) problems.push({ rule: 'wrong-sign', detail: `event ${link.event} linked as ${link.as}` })
      if (!found.some(link => expect.allowed.includes(link.as)) && !found.some(link => expect.forbidden.includes(link.as))) problems.push({ rule: 'missing-link', detail: `no link from the round's events to claim ${against}` })
      break
    }
    case 'no-decisive':
      for (const link of edit.claimLinks ?? []) if (decisive(link.as) && roundSet.has(link.event)) problems.push({ rule: 'decisive-from-talk', detail: `event ${link.event} linked to claim ${link.claim} as ${link.as}` })
      for (const claim of claims) for (const link of claim.links ?? []) if (decisive(link.as)) problems.push({ rule: 'decisive-from-talk', detail: `${link.as} on a new claim` })
      break
    case 'rival-set': {
      const positions = expect.between.map(who => claims.findIndex(claim => claim.byCharacter === who))
      const covered = (edit.claimQuestions ?? []).some(question => positions.every(position => position >= 0 && (question.rivalsNew ?? []).includes(position)))
      if (positions.some(position => position < 0)) problems.push({ rule: 'missing-claim', detail: `no claim by ${expect.between.filter((_, i) => positions[i]! < 0).join(', ')}` })
      else if (!covered) problems.push({ rule: 'missing-question', detail: 'the rival claims are not related in a question' })
      break
    }
    case 'no-question':
      if ((edit.claimQuestions ?? []).length > 0) problems.push({ rule: 'false-question', detail: 'compatible claims were made rivals' })
      break
    case 'hidden-from':
      if (!(edit.concealments ?? []).some(entry => entry.from === expect.who && entry.lift !== true)) problems.push({ rule: 'missing-concealment', detail: `nothing is recorded as kept from ${expect.who}` })
      break
  }
  return problems
}
