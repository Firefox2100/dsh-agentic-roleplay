import { MAX_RIVALS, MIN_RIVALS } from 'dsh-roleplay-model'
import type { Bearing, CharacterId, Claim, ClaimId, ClaimLink, ClaimPart, ClaimQuestion, ClaimQuestionId, ClaimStatus, EventId, NewClaim } from 'dsh-roleplay-model'
import type { Clock } from '../clock.ts'
import type { SqlDatabase } from '../driver/types.ts'
import { ConflictError, CorruptDataError, InvalidValueError, NotFoundError } from '../errors.ts'
import type { ClaimRepository, ConcealmentRepository, GroupRepository } from '../repositories.ts'

interface ClaimRow {
  id: number
  text: string
  by_character_id: number | null
  by_label: string
  asserted_event_id: number | null
  status: ClaimStatus
  parts: string
  created_turn: number
}

interface LinkRow { claim_id: number; event_id: number; bearing: Bearing; part: string }

const parseParts = (id: number, raw: string): ClaimPart[] => {
  try {
    const value: unknown = JSON.parse(raw)
    if (Array.isArray(value)) return value.filter((part): part is ClaimPart => typeof part?.key === 'string' && typeof part?.text === 'string')
  } catch { /* corrupt below */ }
  throw new CorruptDataError(`claim ${id} has unreadable parts`)
}

export class SqliteClaimRepository implements ClaimRepository {
  constructor(private readonly db: SqlDatabase, private readonly clock: Clock) {}

  add(claim: NewClaim): Claim {
    const text = claim.text.trim()
    if (text === '') throw new InvalidValueError('a claim needs its words')
    const parts = claim.parts ?? []
    this.checkLinks(claim.links ?? [], parts)
    if (claim.byCharacterId !== undefined && this.db.get('SELECT 1 FROM characters WHERE id = ?', [claim.byCharacterId]) === undefined) throw new NotFoundError(`character ${claim.byCharacterId} does not exist`)
    if (claim.assertedEventId !== undefined) this.requireEvent(claim.assertedEventId)
    const { lastInsertRowid } = this.db.run(
      'INSERT INTO claims (text, by_character_id, by_label, asserted_event_id, status, parts, created_turn, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [text, claim.byCharacterId ?? null, (claim.byLabel ?? '').trim(), claim.assertedEventId ?? null, claim.status ?? 'proposed', JSON.stringify(parts), claim.createdTurn, this.clock().toISOString()],
    )
    const id = Number(lastInsertRowid)
    for (const link of claim.links ?? []) this.link(id, link)
    return this.require(id)
  }

  get(id: ClaimId): Claim | undefined {
    const row = this.db.get<ClaimRow>('SELECT * FROM claims WHERE id = ?', [id])
    return row === undefined ? undefined : this.toClaim(row, this.linksOf([id]))
  }

  list(filter: { status?: ClaimStatus } = {}): Claim[] {
    const rows = filter.status === undefined
      ? this.db.all<ClaimRow>('SELECT * FROM claims ORDER BY id')
      : this.db.all<ClaimRow>('SELECT * FROM claims WHERE status = ? ORDER BY id', [filter.status])
    const links = this.linksOf(rows.map(row => row.id))
    return rows.map(row => this.toClaim(row, links))
  }

  link(id: ClaimId, link: ClaimLink): Claim {
    const claim = this.require(id)
    this.checkLinks([link], claim.parts)
    this.requireEvent(link.eventId)
    this.db.run('INSERT OR REPLACE INTO claim_links (claim_id, event_id, bearing, part) VALUES (?, ?, ?, ?)', [id, link.eventId, link.bearing, link.part])
    return this.require(id)
  }

  unlink(id: ClaimId, eventId: EventId, part = ''): Claim {
    this.require(id)
    this.db.run('DELETE FROM claim_links WHERE claim_id = ? AND event_id = ? AND part = ?', [id, eventId, part])
    return this.require(id)
  }

  setStatus(id: ClaimId, status: ClaimStatus): Claim {
    this.require(id)
    this.db.run('UPDATE claims SET status = ? WHERE id = ?', [status, id])
    return this.require(id)
  }

  remove(id: ClaimId): boolean {
    return this.db.run('DELETE FROM claims WHERE id = ?', [id]).changes > 0
  }

  addQuestion(text: string, rivals: readonly ClaimId[]): ClaimQuestion {
    const unique = [...new Set(rivals)]
    if (text.trim() === '') throw new InvalidValueError('a question needs its words')
    if (unique.length < MIN_RIVALS || unique.length > MAX_RIVALS) throw new InvalidValueError(`a question holds ${MIN_RIVALS} to ${MAX_RIVALS} rival claims, not ${unique.length}`)
    for (const id of unique) this.require(id)
    const { lastInsertRowid } = this.db.run('INSERT INTO claim_questions (text, created_at) VALUES (?, ?)', [text.trim(), this.clock().toISOString()])
    const id = Number(lastInsertRowid)
    for (const claim of unique) this.db.run('INSERT INTO claim_question_members (question_id, claim_id) VALUES (?, ?)', [id, claim])
    return { id, text: text.trim(), rivals: unique }
  }

  questions(): ClaimQuestion[] {
    const members = this.db.all<{ question_id: number; claim_id: number }>('SELECT question_id, claim_id FROM claim_question_members ORDER BY question_id, claim_id')
    return this.db.all<{ id: number; text: string }>('SELECT id, text FROM claim_questions ORDER BY id').map(row => ({
      id: row.id, text: row.text, rivals: members.filter(member => member.question_id === row.id).map(member => member.claim_id),
    }))
  }

  removeQuestion(id: ClaimQuestionId): boolean {
    return this.db.run('DELETE FROM claim_questions WHERE id = ?', [id]).changes > 0
  }

  private checkLinks(links: readonly ClaimLink[], parts: readonly ClaimPart[]): void {
    const keys = new Set(parts.map(part => part.key))
    if (keys.size !== parts.length || keys.has('')) throw new InvalidValueError('claim parts need distinct, non-empty keys')
    for (const link of links) if (link.part !== '' && !keys.has(link.part)) throw new InvalidValueError(`a link names the part "${link.part}", which the claim does not have`)
  }

  private requireEvent(id: EventId): void {
    if (this.db.get('SELECT 1 FROM events WHERE id = ?', [id]) === undefined) throw new NotFoundError(`event ${id} does not exist`)
  }

  private require(id: ClaimId): Claim {
    const claim = this.get(id)
    if (claim === undefined) throw new NotFoundError(`claim ${id} does not exist`)
    return claim
  }

  private linksOf(ids: readonly number[]): Map<number, ClaimLink[]> {
    const links = new Map<number, ClaimLink[]>()
    if (ids.length === 0) return links
    const rows = this.db.all<LinkRow>(`SELECT * FROM claim_links WHERE claim_id IN (${ids.map(() => '?').join(', ')}) ORDER BY claim_id, event_id, part`, [...ids])
    for (const row of rows) links.set(row.claim_id, [...(links.get(row.claim_id) ?? []), { eventId: row.event_id, bearing: row.bearing, part: row.part }])
    return links
  }

  private toClaim(row: ClaimRow, links: Map<number, ClaimLink[]>): Claim {
    return {
      id: row.id,
      text: row.text,
      ...(row.by_character_id === null ? {} : { byCharacterId: row.by_character_id }),
      byLabel: row.by_label,
      ...(row.asserted_event_id === null ? {} : { assertedEventId: row.asserted_event_id }),
      status: row.status,
      parts: parseParts(row.id, row.parts),
      links: links.get(row.id) ?? [],
      createdTurn: row.created_turn,
    }
  }
}

export class SqliteConcealmentRepository implements ConcealmentRepository {
  constructor(private readonly db: SqlDatabase) {}

  hide(eventId: EventId, characterId: CharacterId): void {
    if (this.db.get('SELECT 1 FROM events WHERE id = ?', [eventId]) === undefined) throw new NotFoundError(`event ${eventId} does not exist`)
    if (this.db.get('SELECT 1 FROM characters WHERE id = ?', [characterId]) === undefined) throw new NotFoundError(`character ${characterId} does not exist`)
    this.db.run('INSERT OR IGNORE INTO event_concealment (event_id, character_id) VALUES (?, ?)', [eventId, characterId])
  }

  reveal(eventId: EventId, characterId: CharacterId): boolean {
    return this.db.run('DELETE FROM event_concealment WHERE event_id = ? AND character_id = ?', [eventId, characterId]).changes > 0
  }

  hiddenFrom(eventId: EventId): CharacterId[] {
    return this.db.all<{ character_id: number }>('SELECT character_id FROM event_concealment WHERE event_id = ? ORDER BY character_id', [eventId]).map(row => row.character_id)
  }

  hiddenEvents(characterId: CharacterId): EventId[] {
    return this.db.all<{ event_id: number }>('SELECT event_id FROM event_concealment WHERE character_id = ? ORDER BY event_id', [characterId]).map(row => row.event_id)
  }
}

export class SqliteGroupRepository implements GroupRepository {
  constructor(private readonly db: SqlDatabase) {}

  include(groupId: CharacterId, memberId: CharacterId): void {
    if (groupId === memberId) throw new InvalidValueError('a group cannot include itself')
    for (const id of [groupId, memberId]) if (this.db.get('SELECT 1 FROM characters WHERE id = ?', [id]) === undefined) throw new NotFoundError(`character ${id} does not exist`)
    if (this.groupsOf(groupId).includes(memberId)) throw new ConflictError('a group cannot include a group that includes it')
    this.db.run('INSERT OR IGNORE INTO character_members (group_id, member_id) VALUES (?, ?)', [groupId, memberId])
  }

  exclude(groupId: CharacterId, memberId: CharacterId): boolean {
    return this.db.run('DELETE FROM character_members WHERE group_id = ? AND member_id = ?', [groupId, memberId]).changes > 0
  }

  members(groupId: CharacterId): CharacterId[] {
    return this.db.all<{ member_id: number }>('SELECT member_id FROM character_members WHERE group_id = ? ORDER BY member_id', [groupId]).map(row => row.member_id)
  }

  groupsOf(memberId: CharacterId): CharacterId[] {
    const found = new Set<number>()
    const queue = [memberId]
    while (queue.length > 0) {
      for (const row of this.db.all<{ group_id: number }>('SELECT group_id FROM character_members WHERE member_id = ?', [queue.shift()!])) {
        if (!found.has(row.group_id)) { found.add(row.group_id); queue.push(row.group_id) }
      }
    }
    return [...found].sort((a, b) => a - b)
  }
}
