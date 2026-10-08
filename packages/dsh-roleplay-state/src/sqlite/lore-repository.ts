import type { Lore, LoreId, LoreKind, LorePatch, LoreSubject, NewLore } from 'dsh-roleplay-model'
import type { SqlDatabase } from '../driver/types.ts'
import { NotFoundError } from '../errors.ts'
import type { LoreRepository } from '../repositories.ts'

interface Row { id: number; source_id: string | null; title: string; kind: LoreKind; summary: string; body: string; starts_at: number | null; ends_at: number | null; sources_json: string; created_at: string }
interface SubjectRow { subject_kind: LoreSubject['kind']; subject_id: number }

export class SqliteLoreRepository implements LoreRepository {
  constructor(private readonly db: SqlDatabase, private readonly now: () => string) {}

  add(entry: NewLore): Lore {
    return this.db.transaction(() => {
      const result = this.db.run('INSERT INTO lore (source_id, title, kind, summary, body, starts_at, ends_at, sources_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)', [entry.sourceId ?? null, required(entry.title), entry.kind, entry.summary, entry.body, entry.startsAt ?? null, entry.endsAt ?? null, JSON.stringify(entry.sources), this.now()])
      this.replaceLinks(result.lastInsertRowid, entry.subjects, entry.related)
      return this.get(result.lastInsertRowid)!
    })
  }

  get(id: LoreId): Lore | undefined {
    const row = this.db.get<Row>('SELECT * FROM lore WHERE id = ?', [id])
    return row === undefined ? undefined : this.fromRow(row)
  }

  getBySourceId(sourceId: string): Lore | undefined {
    const row = this.db.get<Row>('SELECT * FROM lore WHERE source_id = ?', [sourceId])
    return row === undefined ? undefined : this.fromRow(row)
  }

  list(): Lore[] { return this.db.all<Row>('SELECT * FROM lore ORDER BY title COLLATE NOCASE, id').map(row => this.fromRow(row)) }

  update(id: LoreId, patch: LorePatch): Lore {
    const current = this.get(id)
    if (current === undefined) throw new NotFoundError(`lore ${id} does not exist`)
    const next = { ...current, ...patch, startsAt: patch.startsAt === null ? undefined : patch.startsAt ?? current.startsAt, endsAt: patch.endsAt === null ? undefined : patch.endsAt ?? current.endsAt }
    this.db.transaction(() => {
      this.db.run('UPDATE lore SET title = ?, kind = ?, summary = ?, body = ?, starts_at = ?, ends_at = ?, sources_json = ? WHERE id = ?', [required(next.title), next.kind, next.summary, next.body, next.startsAt ?? null, next.endsAt ?? null, JSON.stringify(next.sources), id])
      if (patch.subjects !== undefined || patch.related !== undefined) this.replaceLinks(id, next.subjects, next.related)
    })
    return this.get(id)!
  }

  remove(id: LoreId): boolean { return this.db.run('DELETE FROM lore WHERE id = ?', [id]).changes > 0 }

  private replaceLinks(id: number, subjects: readonly LoreSubject[], related: readonly number[]): void {
    this.db.run('DELETE FROM lore_subjects WHERE lore_id = ?', [id]); this.db.run('DELETE FROM lore_relations WHERE lore_id = ?', [id])
    for (const subject of subjects) this.db.run('INSERT INTO lore_subjects (lore_id, subject_kind, subject_id) VALUES (?, ?, ?)', [id, subject.kind, subject.id])
    for (const other of related) this.db.run('INSERT INTO lore_relations (lore_id, related_lore_id) VALUES (?, ?)', [id, other])
  }

  private fromRow(row: Row): Lore {
    return { id: row.id, ...(row.source_id === null ? {} : { sourceId: row.source_id }), title: row.title, kind: row.kind, summary: row.summary, body: row.body, ...(row.starts_at === null ? {} : { startsAt: row.starts_at }), ...(row.ends_at === null ? {} : { endsAt: row.ends_at }), subjects: this.db.all<SubjectRow>('SELECT subject_kind, subject_id FROM lore_subjects WHERE lore_id = ? ORDER BY subject_kind, subject_id', [row.id]).map(x => ({ kind: x.subject_kind, id: x.subject_id })), related: this.db.all<{ related_lore_id: number }>('SELECT related_lore_id FROM lore_relations WHERE lore_id = ? ORDER BY related_lore_id', [row.id]).map(x => x.related_lore_id), sources: JSON.parse(row.sources_json) as string[], createdAt: row.created_at }
  }
}

function required(value: string): string { const clean = value.trim(); if (clean === '') throw new RangeError('lore title cannot be blank'); return clean }
