/** One part of an opening, in the order the player reads it: narration, or a line a character speaks (by the character's id in the world). */
export type OpeningPart = { type: 'narration'; text: string } | { type: 'utterance'; character: string; text: string } | { type: 'image'; path: string }

/** The most parts one opening may have, and the longest text of all of them together. */
export const MAX_OPENING_PARTS = 60
export const MAX_OPENING_TEXT = 20_000

/** The words of an opening as one text: its parts, a blank line between. */
export const partsText = (parts: readonly OpeningPart[]): string => parts.flatMap(part => (part.type === 'image' ? [] : [part.text])).join('\n\n')

/** The folders of a world's `images/` that a story starts with a copy of; an opening may show a picture from any of them. */
const IMAGE_FOLDERS = ['library', 'characters', 'locations', 'items', 'global']

/** Whether a path names a picture of a world's `images/` that its stories carry: relative, in one of the copied folders, with no dot segments and no backslashes. */
export function isImagePath(path: string): boolean {
  const segments = path.split('/')
  const extension = /\.([a-z0-9]+)$/i.exec(path)?.[1]?.toLowerCase()
  // the gallery serves a picture that is not a PNG only from the library
  const served = extension === 'png' || (segments[0] === 'library' && ['jpg', 'jpeg', 'webp', 'gif', 'avif'].includes(extension ?? ''))
  return path.length <= 300 && served && !path.includes('\\') && segments.length >= 2 && IMAGE_FOLDERS.includes(segments[0]!) && segments.every(segment => segment !== '' && segment !== '.' && segment !== '..')
}

/** Whether any part is spoken by a character: an opening with none is only narration, which a plain text says as well. */
export const hasSpeech = (parts: readonly OpeningPart[]): boolean => parts.some(part => part.type === 'utterance')

/**
 * Reads the parts of an opening from a body that came from a browser or a model: every part is checked and each problem is reported. Blank parts are left out.
 * @returns the parts, or nothing when the value is no list of parts (the problems say why).
 */
export function parseOpeningParts(value: unknown, where: string, problems: string[]): OpeningPart[] | undefined {
  if (!Array.isArray(value)) { problems.push(`${where} must be a list of parts`); return undefined }
  const parts: OpeningPart[] = []
  for (const [index, entry] of value.entries()) {
    const at = `${where}[${index}]`
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) { problems.push(`${at} must be an object`); continue }
    const part = entry as Record<string, unknown>
    const type = part['type'] ?? 'narration'
    if (type !== 'narration' && type !== 'utterance' && type !== 'image') { problems.push(`${at}.type must be "narration", "utterance" or "image"`); continue }
    if (type === 'image') {
      const path = typeof part['path'] === 'string' ? part['path'].trim() : ''
      if (!isImagePath(path)) problems.push(`${at}.path must name a picture of the library, like library/dock.png`)
      else parts.push({ type, path })
      continue
    }
    if (typeof part['text'] !== 'string') { problems.push(`${at}.text must be text`); continue }
    const text = part['text'].trim()
    if (text === '') continue
    if (type === 'narration') { parts.push({ type, text }); continue }
    const character = typeof part['character'] === 'string' ? part['character'].trim() : ''
    if (character === '') { problems.push(`${at}.character is needed for a line a character speaks`); continue }
    parts.push({ type, character, text })
  }
  if (parts.length > MAX_OPENING_PARTS) problems.push(`${where} has more than ${MAX_OPENING_PARTS} parts`)
  if (partsText(parts).length > MAX_OPENING_TEXT) problems.push(`${where} is longer than ${MAX_OPENING_TEXT} characters`)
  return parts
}
