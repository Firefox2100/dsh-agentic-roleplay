import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { atomicWrite } from '../atomic-write.ts'
import { NoEmbeddingService, type ImportContext } from '../import/run.ts'
import { CHECKS_FOLDER } from './results.ts'

const FILE = 'vectors.json'
/** How many texts one request to the embedding provider carries. */
const BATCH = 32
/** The most vectors kept with a world: the newest ones, so a world that changes does not keep every text it ever had. */
const KEPT = 4000

interface Stored {
  version: 1
  model: string
  dimensions: number
  vectors: Record<string, string>
}

const hashOf = (text: string): string => createHash('sha256').update(text).digest('hex').slice(0, 32)
const pack = (vector: readonly number[]): string => Buffer.from(new Float32Array(vector).buffer).toString('base64')
const unpack = (text: string): number[] => { const bytes = Buffer.from(text, 'base64'); return [...new Float32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 4)] }

async function read(directory: string): Promise<Stored | undefined> {
  try {
    const stored = JSON.parse(await readFile(join(directory, CHECKS_FOLDER, FILE), 'utf8')) as Stored
    return stored.version === 1 && typeof stored.vectors === 'object' && stored.vectors !== null ? stored : undefined
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT' || error instanceof SyntaxError) return undefined
    throw error
  }
}

export function cosine(a: readonly number[], b: readonly number[]): number {
  let dot = 0
  let left = 0
  let right = 0
  for (let at = 0; at < a.length; at++) { dot += a[at]! * b[at]!; left += a[at]! * a[at]!; right += b[at]! * b[at]! }
  return left === 0 || right === 0 ? 0 : dot / Math.sqrt(left * right)
}

/**
 * The vectors of texts, in order. What the world has embedded before is kept in its dot folder by the text's hash, so a check run again embeds only what changed; vectors of
 * another model or size are not used. `undefined` when the run has no embedding provider.
 */
export async function vectorsOf(model: ImportContext, directory: string, texts: readonly string[]): Promise<number[][] | undefined> {
  if (model.embed === undefined) return undefined
  const stored = await read(directory)
  const known = new Map<string, number[]>(Object.entries(stored?.vectors ?? {}).map(([hash, packed]) => [hash, unpack(packed)]))
  const hashes = texts.map(hashOf)
  const missing = [...new Set(hashes.filter(hash => !known.has(hash)))]
  if (missing.length === 0) return hashes.map(hash => known.get(hash)!)
  try {
    return await embedded(model, directory, texts, hashes, missing, known, stored?.model ?? '')
  } catch (error) {
    if (error instanceof NoEmbeddingService) return undefined
    throw error
  }
}

async function embedded(model: ImportContext, directory: string, texts: readonly string[], hashes: readonly string[], missing: readonly string[], known: Map<string, number[]>, stored: string): Promise<number[][]> {
  const byHash = new Map(texts.map((text, at) => [hashes[at]!, text]))
  let name = stored
  const made = new Map<string, number[]>()
  const embed = async (wanted: readonly string[]): Promise<void> => {
    for (let at = 0; at < wanted.length; at += BATCH) {
      const batch = wanted.slice(at, at + BATCH)
      const { vectors, model: used } = await model.embed!(batch.map(hash => byHash.get(hash)!))
      if (vectors.length !== batch.length) throw new Error(`the embedding provider returned ${vectors.length} vectors for ${batch.length} texts`)
      if (name !== '' && name !== used) known.clear()
      name = used
      batch.forEach((hash, index) => made.set(hash, vectors[index]!))
    }
  }
  await embed(missing)
  // vectors of another size than the new ones came from another model: what they were kept for is embedded again
  const size = [...made.values()][0]!.length
  for (const [hash, vector] of known) if (vector.length !== size) known.delete(hash)
  await embed([...new Set(hashes.filter(hash => !known.has(hash) && !made.has(hash)))])
  const all = new Map([...known, ...made])
  const result = hashes.map(hash => all.get(hash)!)
  const kept = [...all].slice(-KEPT)
  await atomicWrite(join(directory, CHECKS_FOLDER, FILE), JSON.stringify({ version: 1, model: name, dimensions: size, vectors: Object.fromEntries(kept.map(([hash, vector]) => [hash, pack(vector)])) } satisfies Stored), { createDirectory: true })
  return result
}

export interface Near {
  a: number
  b: number
  score: number
}

/** The pairs of vectors closest to each other that `allowed` accepts and that reach `threshold`, closest first, at most `limit`. */
export function nearPairs(vectors: readonly (readonly number[])[], allowed: (a: number, b: number) => boolean, threshold: number, limit: number): Near[] {
  const pairs: Near[] = []
  for (let a = 0; a < vectors.length; a++) for (let b = a + 1; b < vectors.length; b++) {
    if (!allowed(a, b)) continue
    const score = cosine(vectors[a]!, vectors[b]!)
    if (score >= threshold) pairs.push({ a, b, score })
  }
  return pairs.sort((x, y) => y.score - x.score).slice(0, limit)
}

/**
 * The pairs of texts worth asking a model about: the closest in meaning when there is an embedding provider, otherwise, when asked to, the first `limit` pairs `allowed` accepts (for a short list), else nothing. Closeness only
 * says two texts are about the same thing (trust and affection are close, and not one value), so it picks what to ask and never what is true.
 */
export async function candidates(model: ImportContext, directory: string, texts: readonly string[], allowed: (a: number, b: number) => boolean, threshold: number, limit: number, withoutProvider: 'first' | 'none' = 'none'): Promise<Near[] | undefined> {
  const vectors = await vectorsOf(model, directory, texts)
  if (vectors !== undefined) return nearPairs(vectors, allowed, threshold, limit)
  if (withoutProvider === 'none') return undefined
  const pairs: Near[] = []
  for (let a = 0; a < texts.length && pairs.length < limit; a++) for (let b = a + 1; b < texts.length && pairs.length < limit; b++) if (allowed(a, b)) pairs.push({ a, b, score: 0 })
  return pairs
}
