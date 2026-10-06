import type { Intent } from './intent.ts'
import type { RelationshipPatch } from './relationship.ts'

export type FactionId = number

export interface Faction {
  id: FactionId
  sourceId?: string
  name: string
  aliases: string[]
  summary: string
  description: string
  values: string[]
  structure: string
  createdAt: string
}

export type NewFaction = Omit<Faction, 'id' | 'createdAt'>

export interface FactionState {
  factionId: FactionId
  publicState: string
  innerState: string
  version: number
  updatedAt: string
}

export interface NewFactionState {
  publicState?: string
  innerState?: string
}

export type FactionStatePatch = Partial<NewFactionState>

export const MEMBERSHIP_STATUSES = ['active', 'inactive', 'former'] as const
export type MembershipStatus = typeof MEMBERSHIP_STATUSES[number]

export interface FactionMembership {
  factionId: FactionId
  characterId: number
  role: string
  rank: string
  status: MembershipStatus
  public: boolean
  commitment: number
  joinedTurn: number
  leftTurn?: number
}

export type MembershipPatch = Partial<Pick<FactionMembership, 'role' | 'rank' | 'status' | 'public' | 'commitment' | 'leftTurn'>>

export type SocialSubjectKind = 'character' | 'faction'

export interface FactionRelationship {
  id: number
  fromKind: SocialSubjectKind
  fromId: number
  toKind: SocialSubjectKind
  toId: number
  label: string
  summary: string
  familiarity: number
  trust: number
  affinity: number
  tension: number
  updatedTurn: number
  createdAt: string
}

export interface FactionIntent extends Intent {
  id: number
  factionId: FactionId
  createdAt: string
  updatedAt: string
}

export interface FactionRelationshipDefinition extends RelationshipPatch {
  to: { kind: SocialSubjectKind; id: string }
  label: string
}

export interface FactionMembershipDefinition {
  character: string
  role: string
  rank: string
  status: MembershipStatus
  public: boolean
  commitment: number
}

export interface FactionDefinition {
  id: string
  name: string
  aliases: string[]
  summary: string
  description: string
  values: string[]
  structure: string
  start: {
    publicState: string
    innerState: string
    goals: Intent[]
  }
  members: FactionMembershipDefinition[]
  relationships: FactionRelationshipDefinition[]
}
