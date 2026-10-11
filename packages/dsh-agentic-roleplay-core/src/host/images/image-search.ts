import type { GalleryImage } from '../../shared/gallery.ts'

const WORD = /[\p{L}\p{N}]+/gu
const CJK = /[㐀-鿿぀-ヿ가-힯]/u

/** Function words that say nothing about a picture, so that "a boat at anchor" does not find a wood because both have an "a". */
const STOP = new Set(['a', 'an', 'the', 'at', 'in', 'on', 'of', 'to', 'and', 'or', 'is', 'are', 'was', 'with', 'for', 'by', 'it', 'its', 'as', 'from', 'that', 'this', '的', '了', '在', '是'])

/** Words of a text, folded; a run of CJK characters is also taken in overlapping pairs, because those scripts have no spaces to cut at. */
export function tokensOf(text: string): string[] {
  const tokens: string[] = []
  for (const word of text.normalize('NFKC').toLowerCase().match(WORD) ?? []) {
    const chars = [...word]
    if (!chars.some(char => CJK.test(char))) { if (!STOP.has(word)) tokens.push(word); continue }
    if (chars.length === 1) tokens.push(word)
    for (let at = 0; at + 1 < chars.length; at += 1) tokens.push(`${chars[at]}${chars[at + 1]}`)
  }
  return tokens
}

/** The text an image is found by: what it shows, who is in it and its tags. The prompt is left out: it is mostly instructions. */
export function describedText(image: GalleryImage): string {
  return [image.description ?? '', ...image.subjects.map(subject => subject.name), ...image.tags].join(' ')
}

export interface ImageQuery {
  /** What the picture is to show, in words. */
  text: string
  /** Names of who should be in it. An image that shows more of them ranks higher; none is required, because the agent that asked judges what it is given. */
  subjects?: readonly string[]
  limit?: number
}

export interface ImageMatch {
  image: GalleryImage
  score: number
}

const SUBJECT_WEIGHT = 3
const NAME = (value: string): string => value.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '')

/** The images that may be shown again and are described. */
export function eligibleImages(images: readonly GalleryImage[]): GalleryImage[] {
  return images.filter(image => image.reusable && !image.pending && image.unreadable !== true && (image.description !== undefined || image.tags.length > 0 || image.subjects.length > 0))
}

/**
 * The reusable images that fit a description best, best first. Ranking is by how many of the query's words the image is described with
 * (a word that few images have counts for more; a word also matches another it begins, so fog finds foggy), and a subject of the image named in the query counts extra. Images that are not
 * reusable, are not described yet, or lack a subject the query requires are never returned.
 */
export function searchImages(images: readonly GalleryImage[], query: ImageQuery): ImageMatch[] {
  const inScope = eligibleImages(images)
  const documents = inScope.map(image => [...new Set(tokensOf(describedText(image)))])
  const wanted = [...new Set(tokensOf(query.text))]
  const has = (document: readonly string[], token: string): boolean => document.some(word => word === token || (Math.min(word.length, token.length) >= 3 && (word.startsWith(token) || token.startsWith(word))))
  const frequency = (token: string): number => documents.filter(document => has(document, token)).length
  const scored = inScope.map((image, index): ImageMatch => {
    const document = documents[index]!
    let score = 0
    for (const token of wanted) if (has(document, token)) score += Math.log(1 + inScope.length / (1 + frequency(token)))
    const said = NAME(`${query.text} ${(query.subjects ?? []).join(' ')}`)
    for (const subject of image.subjects) if (NAME(subject.name) !== '' && said.includes(NAME(subject.name))) score += SUBJECT_WEIGHT
    return { image, score }
  })
  return scored.filter(match => match.score > 0).sort((a, b) => b.score - a.score || b.image.createdAt.localeCompare(a.image.createdAt)).slice(0, query.limit ?? 5)
}
