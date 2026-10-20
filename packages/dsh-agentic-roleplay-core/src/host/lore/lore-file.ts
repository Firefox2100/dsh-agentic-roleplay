import { LORE_KINDS, LORE_SCOPES, LORE_SUBJECT_KINDS, type LoreDefinition, type LoreSubjectDefinition } from 'dsh-roleplay-model'
import { readIdentifier } from '../identifiers.ts'
import { Reader, type Issue, type ParseResult } from '../validation.ts'

export const LORE_FILE_NAME = 'lore.json'

function instant(reader: Reader, key: string): number | undefined {
  const value = reader.string(key)
  if (value === undefined) return undefined
  const parsed = Date.parse(value)
  if (!Number.isFinite(parsed)) { reader.fail(key, 'must be an ISO date or date-time'); return undefined }
  return parsed
}

export function parseLoreFile(text: string, fallbackId: string): ParseResult<LoreDefinition> {
  const issues: Issue[] = []
  const reader = Reader.fromJson(text, issues)
  if (reader === undefined) return { ok: false, issues }
  const id = readIdentifier(reader, fallbackId) ?? fallbackId
  const title = reader.string('title', { required: true }) ?? ''
  const subjects = reader.objects('subjects').flatMap((entry): LoreSubjectDefinition[] => {
    const kind = entry.oneOf('kind', LORE_SUBJECT_KINDS, 'lore')
    const subjectId = entry.string('id', { required: true })
    return subjectId === undefined ? [] : [{ kind, id: subjectId }]
  })
  const startsAt = instant(reader, 'starts_at'); const endsAt = instant(reader, 'ends_at')
  if (startsAt !== undefined && endsAt !== undefined && endsAt < startsAt) reader.fail('ends_at', 'must not be before starts_at')
  const scope = reader.oneOf('scope', LORE_SCOPES, 'listed')
  const knownBy = reader.strings('known_by')
  if (scope === 'everyone' && knownBy.length > 0) reader.fail('known_by', 'applies only to lore whose scope is "listed"')
  const value: LoreDefinition = {
    id, title, kind: reader.oneOf('kind', LORE_KINDS, 'other'), scope, knownBy, summary: reader.text('summary'), body: reader.text('body'), subjects,
    related: reader.strings('related'), sources: reader.strings('sources'), ...(startsAt === undefined ? {} : { startsAt }), ...(endsAt === undefined ? {} : { endsAt }),
  }
  return issues.length === 0 ? { ok: true, value } : { ok: false, issues }
}
