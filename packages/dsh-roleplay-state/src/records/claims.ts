import type { Bearing, CharacterId, Claim, ClaimId, ClaimQuestion, EventId, Verdict } from 'dsh-roleplay-model'
import type { ClaimRepository, ConcealmentRepository, EventRepository, GroupRepository } from '../repositories.ts'

export interface ClaimTarget {
  claims: ClaimRepository
  events: EventRepository
  groups: GroupRepository
  concealment: ConcealmentRepository
}

export function deriveVerdict(bearings: readonly Bearing[]): Verdict {
  const has = (bearing: Bearing): boolean => bearings.includes(bearing)
  if (has('confirms') && has('contradicts')) return 'disputed'
  if (has('contradicts')) return 'false'
  if (has('confirms')) return 'true'
  if (has('supports') && has('undermines')) return 'open'
  if (has('supports')) return 'likely'
  if (has('undermines')) return 'unlikely'
  return 'unresolved'
}

interface Standing {
  claims: Map<ClaimId, Claim>
  questions: ClaimQuestion[]
  /** Position of each event in story order. */
  order: Map<EventId, number>
}

function standing(target: ClaimTarget): Standing {
  const claims = new Map(target.claims.list().map(claim => [claim.id, claim]))
  const order = new Map(target.events.list().map((event, index) => [event.id, index]))
  return { claims, questions: target.claims.questions(), order }
}

export interface VerdictOptions {
  /** Count only what is in the story up to and including this event. */
  at?: EventId
  /** Count only the events this character took in: their own view. */
  by?: { characterId: CharacterId; knows: (eventId: EventId) => boolean }
}

/** A link counts once the claim is made and the event is known, and, for a person's view, only if that person took the event in. */
function usable(claim: Claim, eventId: EventId, state: Standing, options: VerdictOptions): boolean {
  const limit = options.at === undefined ? Infinity : state.order.get(options.at) ?? -Infinity
  const made = claim.assertedEventId === undefined ? -Infinity : state.order.get(claim.assertedEventId) ?? Infinity
  const seen = state.order.get(eventId)
  if (seen === undefined || made > limit || seen > limit) return false
  return options.by === undefined || options.by.knows(eventId)
}

function ownBearings(claim: Claim, state: Standing, options: VerdictOptions, part?: string): Bearing[] {
  return claim.links.filter(link => (part === undefined ? link.part === '' : link.part === part) && usable(claim, link.eventId, state, options)).map(link => link.bearing)
}

/** What the events say of one claim; rival sets only ever add what a rival's own links settle (a rival's adjusted verdict never counts, so there is no circle). */
function verdictFrom(claim: Claim, state: Standing, options: VerdictOptions): Verdict {
  if (claim.parts.length > 0) {
    const each = claim.parts.map(part => deriveVerdict(ownBearings(claim, state, options, part.key)))
    return each.every(verdict => verdict === each[0]) ? each[0]! : 'mixed'
  }
  const rivals = state.questions.filter(question => question.rivals.includes(claim.id)).flatMap(question => question.rivals).filter(id => id !== claim.id)
  const added: Bearing[] = []
  for (const id of rivals) {
    const rival = state.claims.get(id)
    if (rival === undefined || rival.parts.length > 0) continue
    const verdict = deriveVerdict(ownBearings(rival, state, options))
    if (verdict === 'true') added.push('contradicts')
    else if (verdict === 'likely') added.push('undermines')
  }
  return deriveVerdict([...ownBearings(claim, state, options), ...added])
}

export interface ClaimReading {
  claim: Claim
  verdict: Verdict
}

/**
 * The claims with what the events say of each. A `proposed` claim is a keeper's suggestion: its verdict is reported like any other, but
 * whoever reads it must not take it as settled.
 */
export function readClaims(target: ClaimTarget, options: VerdictOptions & { status?: Claim['status'] } = {}): ClaimReading[] {
  const state = standing(target)
  return [...state.claims.values()]
    .filter(claim => options.status === undefined || claim.status === options.status)
    .map(claim => ({ claim, verdict: verdictFrom(claim, state, options) }))
}

/** One character's own view of a claim: only the events it took in, as of a moment. */
export function verdictFor(target: ClaimTarget, claimId: ClaimId, characterId: CharacterId, at?: EventId): Verdict | undefined {
  const state = standing(target)
  const claim = state.claims.get(claimId)
  if (claim === undefined) return undefined
  const knows = (eventId: EventId): boolean => knowsEvent(target, characterId, eventId) === 'knows'
  return verdictFrom(claim, state, { by: { characterId, knows }, ...(at === undefined ? {} : { at }) })
}

export type Knowing = 'knows' | 'possibly' | 'no'

/**
 * Whether a character took an event in. `possibly` is for a character in a group that took it in when nothing says they did themselves
 * (a crowd's members are not each asked). An event hidden from a character is `no`, whatever the group took in.
 */
export function knowsEvent(target: Pick<ClaimTarget, 'events' | 'groups' | 'concealment'>, characterId: CharacterId, eventId: EventId): Knowing {
  const perceivers = new Set(target.events.perceptionsOf(eventId).map(perception => perception.characterId))
  if (perceivers.has(characterId)) return 'knows'
  if (target.concealment.hiddenFrom(eventId).includes(characterId)) return 'no'
  return target.groups.groupsOf(characterId).some(group => perceivers.has(group)) ? 'possibly' : 'no'
}

/** Events a character took in although they were kept from it: the record contradicts itself. */
export function concealmentProblems(target: Pick<ClaimTarget, 'events' | 'concealment'>): string[] {
  const problems: string[] = []
  for (const event of target.events.list()) {
    const perceivers = new Set(target.events.perceptionsOf(event.id).map(perception => perception.characterId))
    for (const characterId of target.concealment.hiddenFrom(event.id)) {
      if (perceivers.has(characterId)) problems.push(`event ${event.id} is hidden from character ${characterId}, who also took it in`)
    }
  }
  return problems
}
