import type { VisualIdentity, VisualIdentityInput, VisualIdentityPatch, VisualSubjectKind } from 'dsh-roleplay-model'
import type { Clock } from '../clock.ts'
import type { SqlDatabase } from '../driver/types.ts'
import { InvalidValueError, NotFoundError } from '../errors.ts'
import type { VisualIdentityRepository } from '../repositories.ts'
import { guard, parseStringList, toJson } from './support.ts'

interface VisualIdentityRow {
  subject_kind: VisualSubjectKind
  subject_id: number
  global_id: string | null
  description: string
  tags: string
  negative_tags: string
  version: number
  updated_at: string
}

const MAX_DESCRIPTION = 2_000
const MAX_TAGS = 40

function clean(identity: VisualIdentityInput): VisualIdentityInput {
  const description = identity.description.trim()
  const tags = [...new Set(identity.tags.map(tag => tag.trim()).filter(Boolean))]
  const negativeTags = [...new Set(identity.negativeTags.map(tag => tag.trim()).filter(Boolean))]
  const globalId = identity.globalId?.trim()
  if (description === '') throw new InvalidValueError('a visual identity needs a description')
  if (description.length > MAX_DESCRIPTION) throw new InvalidValueError(`a visual identity description has at most ${MAX_DESCRIPTION} characters`)
  if (tags.length > MAX_TAGS || negativeTags.length > MAX_TAGS) throw new InvalidValueError(`a visual identity has at most ${MAX_TAGS} positive and ${MAX_TAGS} negative tags`)
  if (globalId !== undefined && (globalId === '' || globalId.length > 200)) throw new InvalidValueError('a global visual id must be from 1 to 200 characters')
  return { description, tags, negativeTags, ...(globalId === undefined ? {} : { globalId }) }
}

function fromRow(row: VisualIdentityRow): VisualIdentity {
  return {
    subjectKind: row.subject_kind, subjectId: row.subject_id,
    ...(row.global_id === null ? {} : { globalId: row.global_id }),
    description: row.description, tags: parseStringList(row.tags, 'visual_identities.tags'),
    negativeTags: parseStringList(row.negative_tags, 'visual_identities.negative_tags'),
    version: row.version, updatedAt: row.updated_at,
  }
}

export class SqliteVisualIdentityRepository implements VisualIdentityRepository {
  constructor(
    private readonly db: SqlDatabase,
    private readonly clock: Clock,
    private readonly exists: (kind: VisualSubjectKind, id: number) => boolean,
  ) {}

  set(subjectKind: VisualSubjectKind, subjectId: number, input: VisualIdentityInput): VisualIdentity {
    if (!this.exists(subjectKind, subjectId)) throw new NotFoundError(`${subjectKind} ${subjectId} does not exist`)
    const identity = clean(input)
    return guard(() => {
      this.db.run(
        `INSERT INTO visual_identities (subject_kind, subject_id, global_id, description, tags, negative_tags, version, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, 1, ?)
         ON CONFLICT (subject_kind, subject_id) DO UPDATE SET
           global_id = excluded.global_id, description = excluded.description, tags = excluded.tags,
           negative_tags = excluded.negative_tags, version = visual_identities.version + 1, updated_at = excluded.updated_at`,
        [subjectKind, subjectId, identity.globalId ?? null, identity.description, toJson(identity.tags), toJson(identity.negativeTags), this.clock().toISOString()],
      )
      return this.require(subjectKind, subjectId)
    })
  }

  get(subjectKind: VisualSubjectKind, subjectId: number): VisualIdentity | undefined {
    const row = this.db.get<VisualIdentityRow>('SELECT * FROM visual_identities WHERE subject_kind = ? AND subject_id = ?', [subjectKind, subjectId])
    return row === undefined ? undefined : fromRow(row)
  }

  list(subjectKind?: VisualSubjectKind): VisualIdentity[] {
    const rows = subjectKind === undefined
      ? this.db.all<VisualIdentityRow>('SELECT * FROM visual_identities ORDER BY subject_kind, subject_id')
      : this.db.all<VisualIdentityRow>('SELECT * FROM visual_identities WHERE subject_kind = ? ORDER BY subject_id', [subjectKind])
    return rows.map(fromRow)
  }

  update(subjectKind: VisualSubjectKind, subjectId: number, patch: VisualIdentityPatch): VisualIdentity {
    const current = this.require(subjectKind, subjectId)
    return this.set(subjectKind, subjectId, {
      description: patch.description ?? current.description,
      tags: patch.tags ?? current.tags,
      negativeTags: patch.negativeTags ?? current.negativeTags,
      ...(patch.globalId === undefined ? current.globalId === undefined ? {} : { globalId: current.globalId } : { globalId: patch.globalId }),
    })
  }

  remove(subjectKind: VisualSubjectKind, subjectId: number): boolean {
    return this.db.run('DELETE FROM visual_identities WHERE subject_kind = ? AND subject_id = ?', [subjectKind, subjectId]).changes > 0
  }

  private require(subjectKind: VisualSubjectKind, subjectId: number): VisualIdentity {
    const identity = this.get(subjectKind, subjectId)
    if (identity === undefined) throw new NotFoundError(`${subjectKind} ${subjectId} has no visual identity`)
    return identity
  }
}
