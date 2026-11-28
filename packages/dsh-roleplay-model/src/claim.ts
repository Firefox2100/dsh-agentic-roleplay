import type { CharacterId } from './session.ts'
import type { EventId } from './memory.ts'

/** What an event does to a claim: it settles it (confirms, contradicts) or only weighs on it (supports, undermines). */
export const BEARINGS = ['confirms', 'contradicts', 'supports', 'undermines'] as const
export type Bearing = (typeof BEARINGS)[number]

/** A claim written by a model is proposed until a person settles its wording and links. */
export const CLAIM_STATUSES = ['proposed', 'confirmed'] as const
export type ClaimStatus = (typeof CLAIM_STATUSES)[number]

/** What the events known so far say of a claim. `mixed` is a claim whose parts differ. */
export const VERDICTS = ['true', 'false', 'likely', 'unlikely', 'open', 'disputed', 'unresolved', 'mixed'] as const
export type Verdict = (typeof VERDICTS)[number]

/** A set holds two to four claims: more would let one wrong claim overturn many. */
export const MIN_RIVALS = 2
export const MAX_RIVALS = 4

export type ClaimId = number
export type ClaimQuestionId = number

/** The part of a claim whose links these are; empty is the claim as a whole. */
export interface ClaimPart {
  key: string
  text: string
}

export interface ClaimLink {
  eventId: EventId
  bearing: Bearing
  /** A `ClaimPart.key`, or empty for the whole claim. */
  part: string
}

export interface Claim {
  id: ClaimId
  text: string
  /** A character; none when a person or body that is not one asserts it (an inquiry, a rumour). */
  byCharacterId?: CharacterId
  byLabel: string
  /** The event where the claim is first made; none when it holds from the start. */
  assertedEventId?: EventId
  status: ClaimStatus
  parts: ClaimPart[]
  links: ClaimLink[]
  createdTurn: number
}

export interface NewClaim {
  text: string
  byCharacterId?: CharacterId
  byLabel?: string
  assertedEventId?: EventId
  status?: ClaimStatus
  parts?: ClaimPart[]
  links?: ClaimLink[]
  createdTurn: number
}

/** Mutually exclusive answers to one question. */
export interface ClaimQuestion {
  id: ClaimQuestionId
  text: string
  rivals: ClaimId[]
}
