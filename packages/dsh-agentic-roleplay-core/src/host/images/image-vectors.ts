import { createHash, randomUUID } from 'node:crypto'
import { readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { GalleryImage } from '../../shared/gallery.ts'
import type { Embedder } from '../memory/embedding-index.ts'
import { describedText, eligibleImages, searchImages, type ImageMatch, type ImageQuery } from './image-search.ts'

const VECTORS_FILE = '.vectors.json'
/** Images closer than this to the query by meaning are candidates even when they share no word with it. */
const MIN_SIMILARITY = 0.35
const FUSION_CONSTANT = 60
const DENSE_LIMIT = 10

interface VectorFile { model: string; dimensions: number; entries: Record<string, { hash: string; vector: number[] }> }

const hashOf = (text: string): string => createHash('sha1').update(text).digest('hex')

function cosine(a: readonly number[], b: readonly number[]): number {
  let dot = 0
  let x = 0
  let y = 0
  for (let at = 0; at < a.length; at += 1) { dot += a[at]! * b[at]!; x += a[at]! * a[at]!; y += b[at]! * b[at]! }
  return x === 0 || y === 0 ? 0 : dot / Math.sqrt(x * y)
}

async function readVectors(images: string): Promise<VectorFile | undefined> {
  try {
    const file = JSON.parse(await readFile(join(images, VECTORS_FILE), 'utf8')) as VectorFile
    return typeof file.model === 'string' && typeof file.entries === 'object' && file.entries !== null ? file : undefined
  } catch { return undefined }
}

async function writeVectors(images: string, file: VectorFile): Promise<void> {
  const path = join(images, VECTORS_FILE)
  const temporary = `${path}.${process.pid}.${randomUUID()}.writing`
  await writeFile(temporary, JSON.stringify(file))
  await rename(temporary, path)
}

export interface HybridResult {
  matches: ImageMatch[]
  /** Whether meaning, and not only words, was used. */
  semantic: boolean
}

/**
 * The images that fit a description, by words and, when an embedding service is there, by meaning, the two rankings joined by reciprocal rank so that
 * neither's scale decides. The vectors of the descriptions are kept in `images/.vectors.json` and made again only for a description that changed or a
 * different embedding model. Without the service, or when it fails, the words alone decide.
 */
export async function findImages(sessionFolder: string, images: readonly GalleryImage[], query: ImageQuery, embedder: Embedder | undefined, signal?: AbortSignal): Promise<HybridResult> {
  const limit = query.limit ?? 5
  const lexical = searchImages(images, { ...query, limit: 50 })
  if (embedder === undefined) return { matches: lexical.slice(0, limit), semantic: false }
  const folder = join(sessionFolder, 'images')
  try {
    const pool = eligibleImages(images)
    if (pool.length === 0) return { matches: [], semantic: true }
    const stored = await readVectors(folder)
    const texts = pool.map(image => describedText(image))
    const hashes = texts.map(hashOf)
    const stale = pool.flatMap((image, index) => (stored?.entries[image.path]?.hash === hashes[index] ? [] : [index]))
    let file: VectorFile = stored ?? { model: '', dimensions: 0, entries: {} }
    const options = signal === undefined ? {} : { signal }
    if (stale.length > 0 || file.model === '') {
      const made = await embedder.embed(stale.map(index => texts[index]!), { ...options, inputType: 'document', priority: 'background' })
      // Vectors of another model are not comparable with these: start again.
      if (file.model !== '' && file.model !== made.model) file = { model: made.model, dimensions: made.dimensions, entries: {} }
      file = { model: made.model, dimensions: made.dimensions, entries: { ...file.entries } }
      stale.forEach((index, at) => { file.entries[pool[index]!.path] = { hash: hashes[index]!, vector: made.vectors[at]! } })
      await writeVectors(folder, file)
    }
    const asked = await embedder.embed([query.text], { ...options, inputType: 'query' })
    if (asked.model !== file.model) return { matches: lexical.slice(0, limit), semantic: false }
    const dense = pool.flatMap(image => { const entry = file.entries[image.path]; return entry === undefined ? [] : [{ image, similarity: cosine(asked.vectors[0]!, entry.vector) }] })
      .filter(candidate => candidate.similarity >= MIN_SIMILARITY).sort((a, b) => b.similarity - a.similarity).slice(0, DENSE_LIMIT)
    const fused = new Map<string, ImageMatch>()
    const add = (image: GalleryImage, rank: number): void => {
      const known = fused.get(image.path)
      const share = 1 / (FUSION_CONSTANT + rank)
      fused.set(image.path, { image, score: (known?.score ?? 0) + share })
    }
    lexical.forEach((match, rank) => { add(match.image, rank) })
    dense.forEach((candidate, rank) => { add(candidate.image, rank) })
    const matches = [...fused.values()].sort((a, b) => b.score - a.score || b.image.createdAt.localeCompare(a.image.createdAt)).slice(0, limit).map(match => ({ ...match, score: Math.round(match.score * FUSION_CONSTANT * 100) / 100 }))
    return { matches, semantic: true }
  } catch {
    return { matches: lexical.slice(0, limit), semantic: false }
  }
}
