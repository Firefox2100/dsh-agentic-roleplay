import type { EmbeddingIndexInfo, PendingEmbedding, RecallHit, RecallItemKind } from 'dsh-roleplay-model'
import type { SqlDatabase, SqlValue } from '../driver/types.ts'
import { ConflictError, InvalidValueError } from '../errors.ts'
import { tokens } from '../memory/recall.ts'
import type { MetadataRepository, RecallIndexRepository, RecallSearch, VectorSearch, VectorSupport } from '../repositories.ts'

const METADATA_KEY = 'embedding.index'
const KEY_LETTER: Record<RecallItemKind, string> = { perception: 'p', memory: 'm', event: 'e' }
/** The most terms a lexical query uses: a long situation would otherwise match nearly everything. */
const MAX_QUERY_TERMS = 32
/** A term in more than this share of the indexed texts says little about any of them ("the", a character's name in a story about them). */
const COMMON_SHARE = 0.5
/** The common terms are only dropped once there are enough texts to tell, and never all of them. */
const MIN_TEXTS_FOR_COMMON = 6
/** Hits scoring less than this against the best hit are noise from a shared word. */
const MIN_RELATIVE_SCORE = 0.2

interface ItemRow { id: number; kind: RecallItemKind; ref_id: number; character_id: number; text: string; embedded: number }

const keyOf = (kind: RecallItemKind, refId: number): string => `${KEY_LETTER[kind]}:${refId}`
const blob = (vector: readonly number[]): Uint8Array => new Uint8Array(new Float32Array(vector).buffer)

/**
 * The texts a session can be searched by, and how: what was said or believed or happened is
 * indexed for lexical search (SQLite FTS5 over the same tokens recall uses, so that scripts written
 * without spaces match too), and, once something gives each text a vector, for dense search
 * (the sqlite-vec extension, one vector per text, with the character as a partition so that a
 * search of one character's memory never sees another's).
 *
 * Vectors are made elsewhere: this keeps the texts, says which still need one, and stores them.
 * A change to a text drops its vector, because it no longer describes it.
 */
export class SqliteRecallIndex implements RecallIndexRepository {
  constructor(
    private readonly db: SqlDatabase,
    private readonly metadata: Pick<MetadataRepository, 'getValue' | 'setValue' | 'deleteValue'>,
    readonly vectors: VectorSupport,
  ) {}

  put(item: { kind: RecallItemKind; refId: number; characterId: number; text: string; extra?: string }): void {
    const existing = this.db.get<ItemRow>('SELECT * FROM recall_items WHERE kind = ? AND ref_id = ?', [item.kind, item.refId])
    const terms = [...tokens(`${item.text} ${item.extra ?? ''}`)].join(' ')
    if (existing === undefined) {
      const { lastInsertRowid } = this.db.run('INSERT INTO recall_items (kind, ref_id, character_id, text) VALUES (?, ?, ?, ?)', [item.kind, item.refId, item.characterId, item.text])
      this.db.run('INSERT INTO recall_fts (rowid, tokens) VALUES (?, ?)', [lastInsertRowid, terms])
      return
    }
    const changed = existing.text !== item.text || existing.character_id !== item.characterId
    this.db.run('UPDATE recall_items SET text = ?, character_id = ?, embedded = CASE WHEN ? THEN 0 ELSE embedded END WHERE id = ?', [item.text, item.characterId, changed ? 1 : 0, existing.id])
    this.db.run('DELETE FROM recall_fts WHERE rowid = ?', [existing.id])
    this.db.run('INSERT INTO recall_fts (rowid, tokens) VALUES (?, ?)', [existing.id, terms])
    if (changed) this.dropVector(existing.id)
  }

  remove(kind: RecallItemKind, refId: number): void {
    const existing = this.db.get<ItemRow>('SELECT * FROM recall_items WHERE kind = ? AND ref_id = ?', [kind, refId])
    if (existing === undefined) return
    this.db.run('DELETE FROM recall_fts WHERE rowid = ?', [existing.id])
    this.dropVector(existing.id)
    this.db.run('DELETE FROM recall_items WHERE id = ?', [existing.id])
  }

  lexical({ text, characterId, kinds, limit }: RecallSearch): RecallHit[] {
    const terms = this.informative([...tokens(text)].slice(0, MAX_QUERY_TERMS))
    if (terms.length === 0) return []
    const params: SqlValue[] = [terms.map(term => `"${term.replaceAll('"', '""')}"`).join(' OR ')]
    let where = ''
    if (characterId !== undefined) { where += ' AND i.character_id = ?'; params.push(characterId) }
    if (kinds !== undefined && kinds.length > 0) { where += ` AND i.kind IN (${kinds.map(() => '?').join(', ')})`; params.push(...kinds) }
    params.push(limit)
    const rows = this.db.all<ItemRow & { rank: number }>(
      `SELECT i.*, bm25(recall_fts) AS rank FROM recall_fts JOIN recall_items i ON i.id = recall_fts.rowid
       WHERE recall_fts MATCH ?${where} ORDER BY rank LIMIT ?`,
      params,
    )
    // bm25 is smaller for a better match, and negative: the best hit counts as 1 and the rest relative to it.
    const best = rows.reduce((top, row) => Math.max(top, -row.rank), 0)
    return rows
      .map(row => ({ key: keyOf(row.kind, row.ref_id), kind: row.kind, refId: row.ref_id, score: best === 0 ? 0 : Math.max(0, -row.rank) / best }))
      .filter(hit => hit.score >= MIN_RELATIVE_SCORE)
  }

  /** The terms that tell texts apart: those found in most of the texts are left out, unless that would leave none. */
  private informative(terms: readonly string[]): string[] {
    if (terms.length === 0) return []
    const total = this.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM recall_items')?.n ?? 0
    if (total < MIN_TEXTS_FOR_COMMON) return [...terms]
    const counts = new Map(this.db.all<{ term: string; doc: number }>(
      `SELECT term, doc FROM recall_vocab WHERE term IN (${terms.map(() => '?').join(', ')})`, [...terms],
    ).map(row => [row.term, row.doc]))
    const kept = terms.filter(term => (counts.get(term) ?? 0) <= COMMON_SHARE * total)
    return kept.length > 0 ? kept : [...terms]
  }

  vector({ vector, characterId, limit }: VectorSearch): RecallHit[] {
    const info = this.info()
    if (info === undefined || !this.vectors.available) return []
    if (vector.length !== info.dimensions) throw new InvalidValueError(`the query has ${vector.length} dimensions, the vectors of this session have ${info.dimensions}`)
    const params: SqlValue[] = [blob(vector), limit]
    let where = ''
    if (characterId !== undefined) { where = ' AND character_id = ?'; params.push(characterId) }
    const near = this.db.all<{ rowid: number; distance: number }>(`SELECT rowid, distance FROM recall_vec WHERE embedding MATCH ? AND k = ?${where}`, params)
    if (near.length === 0) return []
    const items = this.db.all<ItemRow>(`SELECT * FROM recall_items WHERE id IN (${near.map(() => '?').join(', ')})`, near.map(entry => entry.rowid))
    const byId = new Map(items.map(item => [item.id, item]))
    return near.flatMap((entry) => {
      const item = byId.get(entry.rowid)
      // The vectors are compared by cosine distance, which is 0 for the same direction and 2 for the opposite.
      return item === undefined ? [] : [{ key: keyOf(item.kind, item.ref_id), kind: item.kind, refId: item.ref_id, score: Math.min(1, Math.max(0, 1 - entry.distance)) }]
    })
  }

  info(): EmbeddingIndexInfo | undefined {
    const stored = this.metadata.getValue(METADATA_KEY) as { model: string; dimensions: number } | undefined
    if (stored === undefined) return undefined
    const counts = this.db.get<{ embedded: number; pending: number }>("SELECT COALESCE(SUM(embedded = 1), 0) AS embedded, COALESCE(SUM(embedded = 0), 0) AS pending FROM recall_items")
    return { model: stored.model, dimensions: stored.dimensions, embedded: counts?.embedded ?? 0, pending: counts?.pending ?? 0 }
  }

  pending(limit: number): PendingEmbedding[] {
    return this.db.all<ItemRow>('SELECT * FROM recall_items WHERE embedded = 0 ORDER BY id LIMIT ?', [limit]).map(row => ({ id: row.id, kind: row.kind, text: row.text }))
  }

  store(model: string, vectors: readonly { id: number; vector: readonly number[] }[]): number {
    if (!this.vectors.available) throw new ConflictError(`vector search is not available here: ${this.vectors.error ?? 'the extension is not loaded'}`)
    if (vectors.length === 0) return 0
    const dimensions = vectors[0]!.vector.length
    return this.db.transaction(() => {
      const info = this.info()
      if (info === undefined) {
        if (dimensions < 1) throw new InvalidValueError('a vector has no dimensions')
        this.db.exec(`CREATE VIRTUAL TABLE recall_vec USING vec0(character_id integer partition key, embedding float[${Math.trunc(dimensions)}] distance_metric=cosine)`)
        this.metadata.setValue(METADATA_KEY, { model, dimensions })
      } else if (info.model !== model || info.dimensions !== dimensions) {
        throw new ConflictError(`this session's vectors are from ${info.model} with ${info.dimensions} dimensions, not ${model} with ${dimensions}: reset the vectors to change them`)
      }
      let stored = 0
      for (const { id, vector } of vectors) {
        if (vector.length !== dimensions) throw new InvalidValueError(`vector of text ${id} has ${vector.length} dimensions, not ${dimensions}`)
        const item = this.db.get<ItemRow>('SELECT * FROM recall_items WHERE id = ?', [id])
        if (item === undefined) continue
        this.db.run('DELETE FROM recall_vec WHERE rowid = ?', [BigInt(id)])
        this.db.run('INSERT INTO recall_vec (rowid, character_id, embedding) VALUES (?, ?, ?)', [BigInt(id), BigInt(item.character_id), blob(vector)])
        this.db.run('UPDATE recall_items SET embedded = 1 WHERE id = ?', [id])
        stored++
      }
      return stored
    })
  }

  reset(): void {
    this.db.transaction(() => {
      if (this.info() === undefined) return
      this.db.exec('DROP TABLE IF EXISTS recall_vec')
      this.db.run('UPDATE recall_items SET embedded = 0')
      this.metadata.deleteValue(METADATA_KEY)
    })
  }

  private dropVector(id: number): void {
    if (this.vectors.available && this.info() !== undefined) this.db.run('DELETE FROM recall_vec WHERE rowid = ?', [BigInt(id)])
  }
}
