import type { CastMember } from './boundaries.ts'
import { sameWords } from './defaults.ts'
import type { NarrationSegment, Utterance } from './protocol.ts'
import type { RawSegment } from './turn-state.ts'

/**
 * A model sometimes sends who speaks as a segment of its own (an utterance with no character whose text is the character's key or name) followed by the words with no
 * character either. When the label is exactly a character of the scene, the label is folded into the words that follow it.
 */
export function foldSpeakerLabels(segments: readonly RawSegment[], cast: readonly CastMember[]): RawSegment[] {
  const found = (label: string): CastMember | undefined => {
    const wanted = label.trim().normalize('NFKC').toLowerCase()
    return wanted === '' ? undefined : cast.find(member => member.key.toLowerCase() === wanted || member.character.name.normalize('NFKC').toLowerCase() === wanted)
  }
  const folded: RawSegment[] = []
  for (let index = 0; index < segments.length; index += 1) {
    const segment = segments[index]!
    const next = segments[index + 1]
    const speaker = segment.type === 'utterance' && (segment.character ?? '') === '' && next?.type === 'utterance' && (next.character ?? '') === '' ? found(segment.text) : undefined
    if (speaker === undefined) { folded.push(segment); continue }
    folded.push({ ...next!, character: speaker.key })
    index += 1
  }
  return folded
}

/** How alike two situations have to be for a round about the second to bring nothing new, by the share of three-letter pieces they have in common. */
const SAME_SITUATION = 0.85

const pieces = (text: string): Set<string> => {
  const found = new Set<string>()
  const chars = [...text]
  for (let index = 0; index + 3 <= chars.length; index += 1) found.add(chars.slice(index, index + 3).join(''))
  return found
}

/** Whether the same characters (or some of them) are asked about a situation that is, but for a few words, one they were already asked about in the turn. */
export function repeatsEarlier(signature: string, asked: readonly string[]): boolean {
  const [keys = '', text = ''] = signature.split('|')
  const now = new Set(keys.split(','))
  const mine = pieces(text)
  return asked.some((earlier) => {
    const [before = '', was = ''] = earlier.split('|')
    if (![...now].every(key => before.split(',').includes(key))) return false
    const theirs = pieces(was)
    const shared = [...mine].filter(piece => theirs.has(piece)).length
    const union = mine.size + theirs.size - shared
    return union === 0 || shared / union >= SAME_SITUATION
  })
}

/** The words as the character said them, whatever quotes the game master put around them. */
export function asSpoken(segments: readonly NarrationSegment[], spoken: readonly Utterance[]): NarrationSegment[] {
  const left = [...spoken]
  return segments.map((segment) => {
    if (segment.type !== 'utterance') return segment
    const at = left.findIndex(said => said.character === segment.character && sameWords(said.text, segment.text))
    return at === -1 ? segment : { ...segment, text: left.splice(at, 1)[0]!.text }
  })
}
