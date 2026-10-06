import { MEMBERSHIP_STATUSES, type FactionDefinition, type FactionMembershipDefinition, type FactionRelationshipDefinition } from 'dsh-roleplay-model'
import { readIntent } from '../characters/character-file.ts'
import { readIdentifier } from '../identifiers.ts'
import { Reader, type Issue, type ParseResult } from '../validation.ts'

export const FACTION_FILE_NAME = 'faction.json'
export const MAX_FACTION_MEMBERS = 500
export const MAX_FACTION_RELATIONSHIPS = 100

function readMembers(reader: Reader): FactionMembershipDefinition[] {
  const seen = new Set<string>()
  const members = reader.objects('members').flatMap((entry): FactionMembershipDefinition[] => {
    const character = entry.string('character', { required: true })
    if (character !== undefined && seen.has(character)) entry.fail('character', `"${character}" is listed twice`)
    if (character !== undefined) seen.add(character)
    const visibility = entry.raw('public')
    if (visibility !== undefined && typeof visibility !== 'boolean') entry.fail('public', 'must be true or false')
    const commitment = entry.number('commitment', { min: 0, max: 1 }) ?? 0.5
    return character === undefined ? [] : [{ character, role: entry.text('role'), rank: entry.text('rank'), status: entry.oneOf('status', MEMBERSHIP_STATUSES, 'active'), public: visibility !== false, commitment }]
  })
  if (members.length > MAX_FACTION_MEMBERS) reader.fail('members', `a faction has at most ${MAX_FACTION_MEMBERS} authored members`)
  return members
}

function readRelationships(reader: Reader): FactionRelationshipDefinition[] {
  const seen = new Set<string>()
  const relationships = reader.objects('relationships').flatMap((entry): FactionRelationshipDefinition[] => {
    const target = entry.object('to')
    if (target === undefined) entry.fail('to', 'is required')
    const kind = target?.oneOf('kind', ['character', 'faction'] as const, 'faction')
    const id = target?.string('id', { required: true })
    const label = entry.string('label', { required: true })
    const key = `${kind}:${id}`
    if (kind !== undefined && id !== undefined && seen.has(key)) target?.fail('id', 'is listed twice from this faction')
    if (kind !== undefined && id !== undefined) seen.add(key)
    if (kind === undefined || id === undefined || label === undefined) return []
    return [{ to: { kind, id }, label, summary: entry.text('summary'), familiarity: entry.number('familiarity', { min: 0, max: 1 }) ?? 0, trust: entry.number('trust', { min: -1, max: 1 }) ?? 0, affinity: entry.number('affinity', { min: -1, max: 1 }) ?? 0, tension: entry.number('tension', { min: 0, max: 1 }) ?? 0 }]
  })
  if (relationships.length > MAX_FACTION_RELATIONSHIPS) reader.fail('relationships', `a faction has at most ${MAX_FACTION_RELATIONSHIPS} relationship profiles`)
  return relationships
}

export function parseFactionFile(text: string, fallbackId: string): ParseResult<FactionDefinition> {
  const issues: Issue[] = []
  const reader = Reader.fromJson(text, issues)
  if (reader === undefined) return { ok: false, issues }
  const start = reader.object('start')
  const id = readIdentifier(reader, fallbackId) ?? fallbackId
  const name = reader.string('name', { required: true })
  const faction: FactionDefinition = {
    id,
    name: name ?? '',
    aliases: reader.strings('aliases').filter(alias => alias.toLowerCase() !== name?.toLowerCase()),
    summary: reader.text('summary'),
    description: reader.text('description'),
    values: reader.strings('values'),
    structure: reader.text('structure'),
    start: { publicState: start?.text('public_state') ?? '', innerState: start?.text('inner_state') ?? '', goals: start?.objects('goals').flatMap(goal => readIntent(goal) ?? []) ?? [] },
    members: readMembers(reader),
    relationships: readRelationships(reader),
  }
  return issues.length === 0 ? { ok: true, value: faction } : { ok: false, issues }
}
