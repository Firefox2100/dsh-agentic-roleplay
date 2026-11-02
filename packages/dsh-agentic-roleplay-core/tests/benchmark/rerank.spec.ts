import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, it } from 'vitest'
import { cosine, nearPairs } from '../../src/host/checks/similar.ts'
import { LANGUAGES } from './language.ts'
import { loreSet, thingsSet, valuesSet, type PairSet } from './pairs.ts'

/**
 * Whether a reranker picks the pairs worth asking a model about better than the closeness of their embeddings does. The checks ask about at most twelve pairs of a world,
 * the closest in meaning above a low cut; a pair that is really one thing but sits thirteenth is never asked. Here every pair of a labelled set is ranked both ways and the
 * share of the real pairs that fall in the twelve is counted. Runs against the development machine's embedding and reranking models:
 *
 *   BENCH_LIVE=1 npx vitest run tests/benchmark/rerank.spec.ts
 */
const live = process.env['BENCH_LIVE'] !== undefined
const url = process.env['BENCH_LLM_URL'] ?? 'http://localhost:8081/v1'
const embedModel = process.env['BENCH_EMBED_MODEL'] ?? 'bge-m3'
const rerankModel = process.env['BENCH_RERANK_MODEL'] ?? 'bge-reranker-v2-m3'
const out = process.env['BENCH_OUT'] ?? join(import.meta.dirname, '..', '..', '..', '..', 'eval', 'results')
const LIMIT = 12
/** How many of the closest pairs by embedding the reranker is given to order: more than the limit, or it could only confirm the embedding's choice. */
const POOL = Number(process.env['BENCH_POOL'] ?? 60)
const THRESHOLDS: Record<string, number> = { values: 0.55, things: 0.6, lore: 0.6 }

async function post<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(`${url}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(300_000) })
  if (!response.ok) throw new Error(`${path} answered ${response.status}`)
  return await response.json() as T
}

const embed = async (texts: string[]): Promise<number[][]> => (await post<{ data: { embedding: number[]; index: number }[] }>('/embeddings', { model: embedModel, input: texts })).data.sort((a, b) => a.index - b.index).map(entry => entry.embedding)
const relevance = async (query: string, documents: string[]): Promise<number[]> => {
  const answer = await post<{ results: { index: number; relevance_score: number }[] }>('/rerank', { model: rerankModel, query, documents })
  const scores = new Array<number>(documents.length).fill(-Infinity)
  for (const result of answer.results) scores[result.index] = result.relevance_score
  return scores
}

const key = (a: number, b: number): string => (a < b ? `${a}:${b}` : `${b}:${a}`)

interface Outcome { set: string; language: string; texts: number; pairs: number; positives: number; ranks: { byCosine: number[]; byReranker: (number | null)[] }; found: { production: number; cosineTop: number; reranked: number; union: number }; productionCandidates: number }

async function trial(set: PairSet, language: string): Promise<Outcome> {
  const vectors = await embed(set.texts)
  const all: { a: number; b: number; score: number }[] = []
  for (let a = 0; a < set.texts.length; a++) for (let b = a + 1; b < set.texts.length; b++) all.push({ a, b, score: cosine(vectors[a]!, vectors[b]!) })
  all.sort((x, y) => y.score - x.score)
  const wanted = new Set(set.positives.map(([a, b]) => key(a, b)))
  const production = nearPairs(vectors, () => true, THRESHOLDS[set.id] ?? 0.6, LIMIT)
  const pool = all.slice(0, POOL)
  // a cross-encoder reads a query and a document in one pass, so a pair is scored both ways and averaged
  const scored = await Promise.all(pool.map(async ({ a, b }) => ({ a, b, score: ((await relevance(set.texts[a]!, [set.texts[b]!]))[0]! + (await relevance(set.texts[b]!, [set.texts[a]!]))[0]!) / 2 })))
  scored.sort((x, y) => y.score - x.score)
  const hits = (list: { a: number; b: number }[]): number => list.slice(0, LIMIT).filter(pair => wanted.has(key(pair.a, pair.b))).length
  const half = (list: { a: number; b: number }[], taken: Set<string>): { a: number; b: number }[] => { const chosen: { a: number; b: number }[] = []; for (const pair of list) { if (chosen.length === LIMIT / 2) break; if (!taken.has(key(pair.a, pair.b))) { taken.add(key(pair.a, pair.b)); chosen.push(pair) } } return chosen }
  const taken = new Set<string>()
  const union = [...half(all, taken), ...half(scored, taken)]
  return {
    set: set.id, language, texts: set.texts.length, pairs: all.length, positives: wanted.size,
    ranks: { byCosine: set.positives.map(([a, b]) => all.findIndex(pair => key(pair.a, pair.b) === key(a, b)) + 1), byReranker: set.positives.map(([a, b]) => { const at = scored.findIndex(pair => key(pair.a, pair.b) === key(a, b)); return at === -1 ? null : at + 1 }) },
    found: { production: production.filter(pair => wanted.has(key(pair.a, pair.b))).length, cosineTop: hits(all), reranked: hits(scored), union: union.filter(pair => wanted.has(key(pair.a, pair.b))).length },
    productionCandidates: production.length,
  }
}

describe.skipIf(!live)('the reranker against the cut by closeness', () => {
  it('ranks the labelled pairs of values, things and background in both languages', async () => {
    const outcomes: Outcome[] = []
    for (const language of LANGUAGES) for (const make of [valuesSet, thingsSet, loreSet]) outcomes.push(await trial(make(language), language))
    mkdirSync(out, { recursive: true })
    writeFileSync(join(out, `checks-rerank-${embedModel}.json`), `${JSON.stringify({ limit: LIMIT, pool: POOL, embedModel, rerankModel, outcomes }, null, 1)}\n`)
    console.log(JSON.stringify(outcomes.map(o => ({ set: o.set, language: o.language, pairs: o.pairs, positives: o.positives, production: `${o.found.production}/${o.positives} of ${o.productionCandidates}`, cosineTop12: `${o.found.cosineTop}/${o.positives}`, reranked12: `${o.found.reranked}/${o.positives}`, union: `${o.found.union}/${o.positives}`, cosineRanks: o.ranks.byCosine, rerankRanks: o.ranks.byReranker })), null, 1))
  }, 3_600_000)
})
