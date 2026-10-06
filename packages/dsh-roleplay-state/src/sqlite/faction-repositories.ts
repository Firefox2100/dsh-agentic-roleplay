import type {
  Faction, FactionId, FactionIntent, FactionMembership, FactionRelationship, FactionState, FactionStatePatch,
  Intent, IntentFilter, IntentPatch, MembershipPatch, MembershipStatus, NewFaction, NewFactionState, RelationshipPatch, SocialSubjectKind,
} from 'dsh-roleplay-model'
import type { Clock } from '../clock.ts'
import type { SqlDatabase, SqlValue } from '../driver/types.ts'
import { ConflictError, InvalidValueError, NotFoundError } from '../errors.ts'
import type { FactionIntentRepository, FactionMembershipRepository, FactionRelationshipRepository, FactionRepository, FactionStateRepository } from '../repositories.ts'
import { guard, lookupKey, parseStringList, toJson } from './support.ts'

interface FactionRow { id: number; source_id: string | null; name: string; summary: string; description: string; values_json: string; structure: string; created_at: string }
interface AliasRow { faction_id: number; alias: string }
interface StateRow { faction_id: number; public_state: string; inner_state: string; version: number; updated_at: string }
interface MembershipRow { faction_id: number; character_id: number; role: string; rank: string; status: MembershipStatus; is_public: number; commitment: number; joined_turn: number; left_turn: number | null }
interface RelationshipRow { id: number; from_kind: SocialSubjectKind; from_id: number; to_kind: SocialSubjectKind; to_id: number; label: string; summary: string; familiarity: number; trust: number; affinity: number; tension: number; updated_turn: number; created_at: string }
interface IntentRow { id: number; faction_id: number; type: Intent['type']; name: string; description: string; status: Intent['status']; horizon: Intent['horizon']; priority: number; urgency: number; plan: string; open_threads: string; constraints: string; deadline: string | null; created_at: string; updated_at: string }

export class SqliteFactionRepository implements FactionRepository {
  constructor(private readonly db: SqlDatabase, private readonly clock: Clock) {}

  add(faction: NewFaction): Faction {
    return guard(() => this.db.transaction(() => {
      const { lastInsertRowid: id } = this.db.run('INSERT INTO factions (source_id, name, name_key, summary, description, values_json, structure, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', [faction.sourceId ?? null, faction.name, lookupKey(faction.name), faction.summary, faction.description, toJson(faction.values), faction.structure, this.clock().toISOString()])
      const stored = new Set<string>()
      for (const alias of faction.aliases) {
        const key = lookupKey(alias)
        if (stored.has(key)) continue
        this.db.run('INSERT INTO faction_aliases (faction_id, position, alias, alias_key) VALUES (?, ?, ?, ?)', [id, stored.size, alias, key])
        stored.add(key)
      }
      return this.get(Number(id))!
    }))
  }

  get(id: FactionId): Faction | undefined { return this.read('WHERE id = ?', [id])[0] }
  getBySourceId(sourceId: string): Faction | undefined { return this.read('WHERE source_id = ?', [sourceId])[0] }
  list(): Faction[] { return this.read('', []) }
  findByName(name: string): Faction[] { return this.read('WHERE name_key = ?1 OR id IN (SELECT faction_id FROM faction_aliases WHERE alias_key = ?1)', [lookupKey(name)]) }

  private read(where: string, params: readonly SqlValue[]): Faction[] {
    const rows = this.db.all<FactionRow>(`SELECT * FROM factions ${where} ORDER BY id`, params)
    const aliases = new Map<number, string[]>()
    for (const row of this.db.all<AliasRow>(`SELECT faction_id, alias FROM faction_aliases WHERE faction_id IN (SELECT id FROM factions ${where}) ORDER BY faction_id, position`, params)) aliases.set(row.faction_id, [...aliases.get(row.faction_id) ?? [], row.alias])
    return rows.map(row => ({ id: row.id, ...(row.source_id === null ? {} : { sourceId: row.source_id }), name: row.name, aliases: aliases.get(row.id) ?? [], summary: row.summary, description: row.description, values: parseStringList(row.values_json, 'factions.values_json'), structure: row.structure, createdAt: row.created_at }))
  }
}

export class SqliteFactionStateRepository implements FactionStateRepository {
  constructor(private readonly db: SqlDatabase, private readonly clock: Clock) {}
  create(factionId: FactionId, state: NewFactionState): FactionState {
    return guard(() => this.db.transaction(() => {
      if (this.db.get('SELECT 1 FROM factions WHERE id = ?', [factionId]) === undefined) throw new NotFoundError(`faction ${factionId} does not exist`)
      this.db.run('INSERT INTO faction_state (faction_id, public_state, inner_state, updated_at) VALUES (?, ?, ?, ?)', [factionId, state.publicState ?? '', state.innerState ?? '', this.clock().toISOString()])
      return this.get(factionId)!
    }))
  }
  get(factionId: FactionId): FactionState | undefined {
    const row = this.db.get<StateRow>('SELECT * FROM faction_state WHERE faction_id = ?', [factionId])
    return row === undefined ? undefined : { factionId: row.faction_id, publicState: row.public_state, innerState: row.inner_state, version: row.version, updatedAt: row.updated_at }
  }
  update(factionId: FactionId, patch: FactionStatePatch, options: { expectedVersion?: number } = {}): FactionState {
    const current = this.get(factionId)
    if (current === undefined) throw new NotFoundError(`faction ${factionId} has no state`)
    if (options.expectedVersion !== undefined && options.expectedVersion !== current.version) throw new ConflictError(`the state of faction ${factionId} is at version ${current.version}, not ${options.expectedVersion}`)
    if (Object.keys(patch).length === 0) return current
    this.db.run('UPDATE faction_state SET public_state = ?, inner_state = ?, version = version + 1, updated_at = ? WHERE faction_id = ?', [patch.publicState ?? current.publicState, patch.innerState ?? current.innerState, this.clock().toISOString(), factionId])
    return this.get(factionId)!
  }
}

const membership = (row: MembershipRow): FactionMembership => ({ factionId: row.faction_id, characterId: row.character_id, role: row.role, rank: row.rank, status: row.status, public: row.is_public === 1, commitment: row.commitment, joinedTurn: row.joined_turn, ...(row.left_turn === null ? {} : { leftTurn: row.left_turn }) })

export class SqliteFactionMembershipRepository implements FactionMembershipRepository {
  constructor(private readonly db: SqlDatabase) {}
  upsert(factionId: FactionId, characterId: number, patch: MembershipPatch, turn: number): FactionMembership {
    if (patch.commitment !== undefined && (!Number.isFinite(patch.commitment) || patch.commitment < 0 || patch.commitment > 1)) throw new InvalidValueError('commitment must be a number from 0 to 1')
    return guard(() => this.db.transaction(() => {
      if (this.db.get('SELECT 1 FROM factions WHERE id = ?', [factionId]) === undefined) throw new NotFoundError(`faction ${factionId} does not exist`)
      if (this.db.get('SELECT 1 FROM characters WHERE id = ?', [characterId]) === undefined) throw new NotFoundError(`character ${characterId} does not exist`)
      const current = this.get(factionId, characterId)
      if (current === undefined) this.db.run('INSERT INTO faction_memberships (faction_id, character_id, role, rank, status, is_public, commitment, joined_turn, left_turn) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)', [factionId, characterId, patch.role ?? '', patch.rank ?? '', patch.status ?? 'active', patch.public === false ? 0 : 1, patch.commitment ?? 0, turn, patch.leftTurn ?? null])
      else this.db.run('UPDATE faction_memberships SET role = ?, rank = ?, status = ?, is_public = ?, commitment = ?, left_turn = ? WHERE faction_id = ? AND character_id = ?', [patch.role ?? current.role, patch.rank ?? current.rank, patch.status ?? current.status, (patch.public ?? current.public) ? 1 : 0, patch.commitment ?? current.commitment, patch.leftTurn ?? current.leftTurn ?? null, factionId, characterId])
      return this.get(factionId, characterId)!
    }))
  }
  get(factionId: FactionId, characterId: number): FactionMembership | undefined { const row = this.db.get<MembershipRow>('SELECT * FROM faction_memberships WHERE faction_id = ? AND character_id = ?', [factionId, characterId]); return row === undefined ? undefined : membership(row) }
  ofFaction(factionId: FactionId, status?: MembershipStatus): FactionMembership[] { return this.db.all<MembershipRow>(`SELECT * FROM faction_memberships WHERE faction_id = ?${status === undefined ? '' : ' AND status = ?'} ORDER BY character_id`, status === undefined ? [factionId] : [factionId, status]).map(membership) }
  ofCharacter(characterId: number, status?: MembershipStatus): FactionMembership[] { return this.db.all<MembershipRow>(`SELECT * FROM faction_memberships WHERE character_id = ?${status === undefined ? '' : ' AND status = ?'} ORDER BY faction_id`, status === undefined ? [characterId] : [characterId, status]).map(membership) }
  remove(factionId: FactionId, characterId: number): boolean { return this.db.run('DELETE FROM faction_memberships WHERE faction_id = ? AND character_id = ?', [factionId, characterId]).changes > 0 }
}

const RANGES = { familiarity: [0, 1], trust: [-1, 1], affinity: [-1, 1], tension: [0, 1] } as const
const relationship = (row: RelationshipRow): FactionRelationship => ({ id: row.id, fromKind: row.from_kind, fromId: row.from_id, toKind: row.to_kind, toId: row.to_id, label: row.label, summary: row.summary, familiarity: row.familiarity, trust: row.trust, affinity: row.affinity, tension: row.tension, updatedTurn: row.updated_turn, createdAt: row.created_at })

export class SqliteFactionRelationshipRepository implements FactionRelationshipRepository {
  constructor(private readonly db: SqlDatabase, private readonly clock: Clock) {}
  upsert(fromKind: SocialSubjectKind, fromId: number, toKind: SocialSubjectKind, toId: number, patch: RelationshipPatch, turn: number): FactionRelationship {
    if (fromKind === toKind && fromId === toId) throw new InvalidValueError('an entity has no relationship with itself')
    for (const [key, [min, max]] of Object.entries(RANGES) as [keyof typeof RANGES, readonly [number, number]][]) { const value = patch[key]; if (value !== undefined && (!Number.isFinite(value) || value < min || value > max)) throw new InvalidValueError(`${key} must be a number from ${min} to ${max}`) }
    if (patch.label !== undefined && patch.label.trim() === '') throw new InvalidValueError('a relationship needs a label')
    return guard(() => this.db.transaction(() => {
      this.requireSubject(fromKind, fromId); this.requireSubject(toKind, toId)
      const current = this.get(fromKind, fromId, toKind, toId)
      if (current === undefined) {
        if (patch.label === undefined) throw new InvalidValueError('a new relationship needs a label')
        this.db.run('INSERT INTO faction_relationships (from_kind, from_id, to_kind, to_id, label, summary, familiarity, trust, affinity, tension, updated_turn, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', [fromKind, fromId, toKind, toId, patch.label.trim(), (patch.summary ?? '').trim(), patch.familiarity ?? 0, patch.trust ?? 0, patch.affinity ?? 0, patch.tension ?? 0, turn, this.clock().toISOString()])
      } else this.db.run('UPDATE faction_relationships SET label = ?, summary = ?, familiarity = ?, trust = ?, affinity = ?, tension = ?, updated_turn = ? WHERE id = ?', [(patch.label ?? current.label).trim(), (patch.summary ?? current.summary).trim(), patch.familiarity ?? current.familiarity, patch.trust ?? current.trust, patch.affinity ?? current.affinity, patch.tension ?? current.tension, turn, current.id])
      return this.get(fromKind, fromId, toKind, toId)!
    }))
  }
  get(fromKind: SocialSubjectKind, fromId: number, toKind: SocialSubjectKind, toId: number): FactionRelationship | undefined { const row = this.db.get<RelationshipRow>('SELECT * FROM faction_relationships WHERE from_kind = ? AND from_id = ? AND to_kind = ? AND to_id = ?', [fromKind, fromId, toKind, toId]); return row === undefined ? undefined : relationship(row) }
  from(kind: SocialSubjectKind, id: number): FactionRelationship[] { return this.db.all<RelationshipRow>('SELECT * FROM faction_relationships WHERE from_kind = ? AND from_id = ? ORDER BY id', [kind, id]).map(relationship) }
  to(kind: SocialSubjectKind, id: number): FactionRelationship[] { return this.db.all<RelationshipRow>('SELECT * FROM faction_relationships WHERE to_kind = ? AND to_id = ? ORDER BY id', [kind, id]).map(relationship) }
  list(): FactionRelationship[] { return this.db.all<RelationshipRow>('SELECT * FROM faction_relationships ORDER BY id').map(relationship) }
  remove(fromKind: SocialSubjectKind, fromId: number, toKind: SocialSubjectKind, toId: number): boolean { return this.db.run('DELETE FROM faction_relationships WHERE from_kind = ? AND from_id = ? AND to_kind = ? AND to_id = ?', [fromKind, fromId, toKind, toId]).changes > 0 }
  private requireSubject(kind: SocialSubjectKind, id: number): void { if (this.db.get(`SELECT 1 FROM ${kind === 'character' ? 'characters' : 'factions'} WHERE id = ?`, [id]) === undefined) throw new NotFoundError(`${kind} ${id} does not exist`) }
}

const factionIntent = (row: IntentRow): FactionIntent => ({ id: row.id, factionId: row.faction_id, type: row.type, name: row.name, description: row.description, status: row.status, horizon: row.horizon, priority: row.priority, urgency: row.urgency, plan: parseStringList(row.plan, 'faction_intents.plan'), openThreads: parseStringList(row.open_threads, 'faction_intents.open_threads'), constraints: parseStringList(row.constraints, 'faction_intents.constraints'), ...(row.deadline === null ? {} : { deadline: row.deadline }), createdAt: row.created_at, updatedAt: row.updated_at })

export class SqliteFactionIntentRepository implements FactionIntentRepository {
  constructor(private readonly db: SqlDatabase, private readonly clock: Clock) {}
  add(factionId: FactionId, intent: Intent): FactionIntent {
    return guard(() => this.db.transaction(() => {
      if (this.db.get('SELECT 1 FROM factions WHERE id = ?', [factionId]) === undefined) throw new NotFoundError(`faction ${factionId} does not exist`)
      const now = this.clock().toISOString()
      const { lastInsertRowid } = this.db.run('INSERT INTO faction_intents (faction_id, type, name, description, status, horizon, priority, urgency, plan, open_threads, constraints, deadline, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', [factionId, intent.type, intent.name, intent.description, intent.status, intent.horizon, intent.priority, intent.urgency, toJson(intent.plan), toJson(intent.openThreads), toJson(intent.constraints), intent.deadline ?? null, now, now])
      return this.get(Number(lastInsertRowid))!
    }))
  }
  get(id: number): FactionIntent | undefined { const row = this.db.get<IntentRow>('SELECT * FROM faction_intents WHERE id = ?', [id]); return row === undefined ? undefined : factionIntent(row) }
  list(factionId: FactionId, filter: IntentFilter = {}): FactionIntent[] { const params: SqlValue[] = [factionId]; let where = 'faction_id = ?'; if (filter.status !== undefined) { where += ' AND status = ?'; params.push(filter.status) }; return this.db.all<IntentRow>(`SELECT * FROM faction_intents WHERE ${where} ORDER BY id`, params).map(factionIntent) }
  update(id: number, patch: IntentPatch): FactionIntent {
    const current = this.get(id); if (current === undefined) throw new NotFoundError(`faction intent ${id} does not exist`)
    this.db.run('UPDATE faction_intents SET type = ?, name = ?, description = ?, status = ?, horizon = ?, priority = ?, urgency = ?, plan = ?, open_threads = ?, constraints = ?, deadline = ?, updated_at = ? WHERE id = ?', [patch.type ?? current.type, patch.name ?? current.name, patch.description ?? current.description, patch.status ?? current.status, patch.horizon ?? current.horizon, patch.priority ?? current.priority, patch.urgency ?? current.urgency, toJson(patch.plan ?? current.plan), toJson(patch.openThreads ?? current.openThreads), toJson(patch.constraints ?? current.constraints), patch.deadline === undefined ? current.deadline ?? null : patch.deadline, this.clock().toISOString(), id])
    return this.get(id)!
  }
  remove(id: number): boolean { return this.db.run('DELETE FROM faction_intents WHERE id = ?', [id]).changes > 0 }
}
