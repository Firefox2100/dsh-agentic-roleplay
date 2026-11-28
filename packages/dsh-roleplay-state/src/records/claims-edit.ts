import { BEARINGS, CLAIM_STATUSES, MAX_RIVALS, MIN_RIVALS } from 'dsh-roleplay-model'
import type { Bearing, CharacterId, ClaimPart, ClaimStatus } from 'dsh-roleplay-model'
import type { ClaimRepository, ConcealmentRepository, EventRepository, GroupRepository } from '../repositories.ts'

export interface ClaimLinkSpec {
  /** An event already recorded, or `eventNew`: the position (from 0) of an event of this same edit. */
  event?: number
  eventNew?: number
  as: Bearing
  /** The key of a part of the claim; the whole claim when left out. */
  part?: string
}

export interface NewClaimSpec {
  text: string
  /** The key of the character who makes the claim; or `byLabel` for one who is not a character: an inquiry, a rumour. */
  byCharacter?: string
  byLabel?: string
  /** The event where it is first made: already recorded, or `assertedInNew`, the position of an event of this edit. */
  assertedIn?: number
  assertedInNew?: number
  /** A model's claim is proposed until a person settles it; only that person's tools may write `confirmed`. */
  status?: ClaimStatus
  parts?: ClaimPart[]
  links?: ClaimLinkSpec[]
}

export interface ClaimLinkChange {
  claim: number
  event: number
  as: Bearing
  part?: string
}

export interface ClaimUnlink {
  claim: number
  event: number
  part?: string
}

export interface ClaimStatusChange {
  claim: number
  status: ClaimStatus
}

/** Two to four claims that cannot all be true; `rivalsNew` names claims made in this same edit by position. */
export interface NewClaimQuestionSpec {
  text: string
  rivals?: number[]
  rivalsNew?: number[]
}

/** An event kept from a character; `lift` records that it is no longer hidden. */
export interface ConcealmentSpec {
  event: number
  from: string
  lift?: boolean
}

export interface GroupMemberSpec {
  group: string
  member: string
  remove?: boolean
}

export interface ClaimsEdit {
  turn: number
  events?: readonly unknown[]
  claims?: NewClaimSpec[]
  claimLinks?: ClaimLinkChange[]
  claimUnlinks?: ClaimUnlink[]
  claimStatuses?: ClaimStatusChange[]
  claimRetractions?: number[]
  claimQuestions?: NewClaimQuestionSpec[]
  concealments?: ConcealmentSpec[]
  groupMembers?: GroupMemberSpec[]
}

export interface ClaimsTarget {
  claims: ClaimRepository
  events: EventRepository
  concealment: ConcealmentRepository
  groups: GroupRepository
}

interface Prepared {
  /** Writes what was checked, given the ids of the events this edit recorded; returns the ids of the claims made and how many rows changed. */
  apply(eventIds: readonly number[]): { claimIds: number[]; writes: number }
}

const list = <T>(value: readonly T[] | undefined): readonly T[] => value ?? []
const partOf = (parts: readonly ClaimPart[], part: string | undefined): string => (parts.length === 0 ? '' : part ?? '')

/** Checks the claims, links, rival sets, concealments and groups of an edit and adds every problem found; the returned writer assumes nothing is wrong. */
export function prepareClaims(target: ClaimsTarget, edit: ClaimsEdit, helpers: { idOf: (key: string, where: string) => CharacterId | undefined; problems: string[] }): Prepared {
  const { idOf, problems } = helpers
  const newEvents = list(edit.events).length
  const eventKnown = (id: number | undefined, position: number | undefined, where: string): boolean => {
    if ((id === undefined) === (position === undefined)) { problems.push(`${where}: name the event by "event" (a recorded one) or "event_new" (the position of an event in this edit), not both or neither`); return false }
    if (id !== undefined && target.events.get(id) === undefined) { problems.push(`${where}: there is no event ${id}`); return false }
    if (position !== undefined && !(Number.isInteger(position) && position >= 0 && position < newEvents)) { problems.push(`${where}: this edit records ${newEvents} events, so there is no position ${position}`); return false }
    return true
  }
  const bearingOk = (value: string, where: string): void => { if (!(BEARINGS as readonly string[]).includes(value)) problems.push(`${where}: "as" must be one of ${BEARINGS.join(', ')}`) }
  // a claim without parts has nothing to name: a part given for it is a slip and is ignored, not refused
  const partOk = (parts: readonly ClaimPart[], part: string | undefined, where: string): void => { if (parts.length > 0 && part !== undefined && part !== '' && !parts.some(candidate => candidate.key === part)) problems.push(`${where}: the claim has no part "${part}"`) }

  const wording = (text: string): string => text.toLowerCase().replace(/[\s.,;:!?。，；：！？"'“”‘’]+/gu, ' ').trim()
  const maker = (byCharacter: string | undefined, byLabel: string | undefined, id: CharacterId | undefined): string => (byCharacter !== undefined ? `c${id ?? byCharacter}` : byLabel !== undefined ? `l${byLabel.toLowerCase()}` : '')
  const known = target.claims.list().map(existing => ({ id: existing.id as number | string, text: wording(existing.text), by: existing.byCharacterId !== undefined ? `c${existing.byCharacterId}` : existing.byLabel !== undefined ? `l${existing.byLabel.toLowerCase()}` : '' }))
  list(edit.claims).forEach((claim, index) => {
    const where = `claims[${index}]`
    if (typeof claim.text !== 'string' || claim.text.trim() === '') problems.push(`${where}: a claim needs its words`)
    if (claim.byCharacter !== undefined && claim.byLabel !== undefined) problems.push(`${where}: give by_character or by_label, not both`)
    const author = claim.byCharacter === undefined ? undefined : idOf(claim.byCharacter, `${where}.by_character`)
    if (typeof claim.text === 'string' && claim.text.trim() !== '') {
      const words = wording(claim.text)
      const by = maker(claim.byCharacter, claim.byLabel, author)
      const twin = known.find(existing => existing.text === words && existing.by === by)
      if (twin !== undefined) problems.push(`${where}: the same claim by the same person is already recorded (${typeof twin.id === 'number' ? `claim ${twin.id}` : 'earlier in this edit'}): link the new evidence to it with claim_links instead of writing it again`)
      else known.push({ id: 'new', text: words, by })
    }
    if (claim.assertedIn !== undefined || claim.assertedInNew !== undefined) {
      if (claim.assertedIn !== undefined && claim.assertedInNew !== undefined) problems.push(`${where}: give asserted_in or asserted_in_new, not both`)
      else eventKnown(claim.assertedIn, claim.assertedInNew, `${where}.asserted_in`)
    }
    if (claim.status !== undefined && !(CLAIM_STATUSES as readonly string[]).includes(claim.status)) problems.push(`${where}: status must be one of ${CLAIM_STATUSES.join(', ')}`)
    const keys = list(claim.parts).map(part => part.key)
    if (new Set(keys).size !== keys.length || keys.includes('')) problems.push(`${where}.parts: each part needs its own key`)
    list(claim.links).forEach((link, at) => {
      eventKnown(link.event, link.eventNew, `${where}.links[${at}]`)
      const own = claim.assertedIn !== undefined ? link.event === claim.assertedIn : claim.assertedInNew !== undefined && link.eventNew === claim.assertedInNew
      if (own) problems.push(`${where}.links[${at}]: the event in which the claim is made is not evidence for it`)
      bearingOk(link.as, `${where}.links[${at}]`)
      partOk(list(claim.parts), link.part, `${where}.links[${at}]`)
    })
  })
  list(edit.claimLinks).forEach((change, index) => {
    const where = `claim_links[${index}]`
    const claim = target.claims.get(change.claim)
    if (claim === undefined) problems.push(`${where}: there is no claim ${change.claim}`)
    else partOk(claim.parts, change.part, where)
    eventKnown(change.event, undefined, where)
    if (claim !== undefined && claim.assertedEventId === change.event) problems.push(`${where}: the event in which the claim is made is not evidence for it`)
    bearingOk(change.as, where)
  })
  list(edit.claimUnlinks).forEach((change, index) => { if (target.claims.get(change.claim) === undefined) problems.push(`claim_unlinks[${index}]: there is no claim ${change.claim}`) })
  list(edit.claimStatuses).forEach((change, index) => {
    if (target.claims.get(change.claim) === undefined) problems.push(`claim_statuses[${index}]: there is no claim ${change.claim}`)
    if (!(CLAIM_STATUSES as readonly string[]).includes(change.status)) problems.push(`claim_statuses[${index}]: status must be one of ${CLAIM_STATUSES.join(', ')}`)
  })
  list(edit.claimRetractions).forEach((id, index) => { if (target.claims.get(id) === undefined) problems.push(`claim_retractions[${index}]: there is no claim ${id}`) })
  const made = list(edit.claims).length
  list(edit.claimQuestions).forEach((question, index) => {
    const where = `claim_questions[${index}]`
    if (typeof question.text !== 'string' || question.text.trim() === '') problems.push(`${where}: a question needs its words`)
    const known = list(question.rivals)
    for (const id of known) if (target.claims.get(id) === undefined) problems.push(`${where}: there is no claim ${id}`)
    for (const position of list(question.rivalsNew)) if (!(Number.isInteger(position) && position >= 0 && position < made)) problems.push(`${where}: this edit makes ${made} claims, so there is no position ${position}`)
    const count = new Set([...known, ...list(question.rivalsNew).map(position => -1 - position)]).size
    if (count < MIN_RIVALS || count > MAX_RIVALS) problems.push(`${where}: a question holds ${MIN_RIVALS} to ${MAX_RIVALS} rival claims that cannot all be true, not ${count}; split a larger cluster into questions that are each exclusive`)
  })
  list(edit.concealments).forEach((entry, index) => {
    const where = `concealments[${index}]`
    eventKnown(entry.event, undefined, where)
    idOf(entry.from, `${where}.from`)
  })
  list(edit.groupMembers).forEach((entry, index) => {
    const where = `group_members[${index}]`
    const group = idOf(entry.group, `${where}.group`)
    const member = idOf(entry.member, `${where}.member`)
    if (group !== undefined && member !== undefined && entry.remove !== true) {
      if (group === member) problems.push(`${where}: a group cannot include itself`)
      else if (target.groups.groupsOf(group).includes(member)) problems.push(`${where}: a group cannot include a group that includes it`)
    }
  })

  return {
    apply(eventIds) {
      let writes = 0
      const claimIds: number[] = []
      const eventAt = (id: number | undefined, position: number | undefined): number => id ?? eventIds[position!]!
      for (const claim of list(edit.claims)) {
        const added = target.claims.add({
          text: claim.text,
          ...(claim.byCharacter === undefined ? {} : { byCharacterId: idOf(claim.byCharacter, '')! }),
          ...(claim.byLabel === undefined ? {} : { byLabel: claim.byLabel }),
          ...(claim.assertedIn === undefined && claim.assertedInNew === undefined ? {} : { assertedEventId: eventAt(claim.assertedIn, claim.assertedInNew) }),
          ...(claim.status === undefined ? {} : { status: claim.status }),
          parts: list(claim.parts).map(part => ({ key: part.key, text: part.text })),
          links: list(claim.links).map(link => ({ eventId: eventAt(link.event, link.eventNew), bearing: link.as, part: partOf(list(claim.parts), link.part) })),
          createdTurn: edit.turn,
        })
        claimIds.push(added.id)
        writes += 1
      }
      for (const change of list(edit.claimLinks)) { target.claims.link(change.claim, { eventId: change.event, bearing: change.as, part: partOf(target.claims.get(change.claim)!.parts, change.part) }); writes += 1 }
      for (const change of list(edit.claimUnlinks)) { target.claims.unlink(change.claim, change.event, partOf(target.claims.get(change.claim)?.parts ?? [], change.part)); writes += 1 }
      for (const change of list(edit.claimStatuses)) { target.claims.setStatus(change.claim, change.status); writes += 1 }
      for (const id of list(edit.claimRetractions)) { target.claims.remove(id); writes += 1 }
      for (const question of list(edit.claimQuestions)) {
        target.claims.addQuestion(question.text, [...list(question.rivals), ...list(question.rivalsNew).map(position => claimIds[position]!)])
        writes += 1
      }
      for (const entry of list(edit.concealments)) {
        const character = idOf(entry.from, '')!
        if (entry.lift === true) target.concealment.reveal(entry.event, character)
        else target.concealment.hide(entry.event, character)
        writes += 1
      }
      for (const entry of list(edit.groupMembers)) {
        const group = idOf(entry.group, '')!
        const member = idOf(entry.member, '')!
        if (entry.remove === true) target.groups.exclude(group, member)
        else target.groups.include(group, member)
        writes += 1
      }
      return { claimIds, writes }
    },
  }
}
