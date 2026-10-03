import type { Character, CharacterId, CharacterMemory, PerceivedEvent } from 'dsh-roleplay-model'
import type { EventRepository, MemoryRepository } from '../repositories.ts'

/** How a character remembers. */
export interface MemoryPolicy {
  /** Whether memories fade with age and unimportance. Off for exact recall. */
  flaky: boolean
  /** The most things a character is reminded of at once. */
  recall: number
}

export const DEFAULT_MEMORY_POLICY: MemoryPolicy = { flaky: true, recall: 12 }

/** How much of a memory is left: what the character is told of it. */
export type Clarity = 'clear' | 'faded' | 'vague'

/** One thing a character is reminded of, as it comes back to it. */
export interface Recalled {
  clarity: Clarity
  /** What the character remembers; less of it the fainter the memory. */
  text: string
  /** The turn it comes from. */
  turn: number
  source: { kind: 'perception' | 'memory'; id: number }
}

export interface RecallQuery {
  characterId: CharacterId
  /** Everyone in the story, so that names in the situation can be told. */
  characters: readonly Character[]
  /** What is happening now, which is what reminds the character of things. */
  situation: string
  turn: number
  policy: MemoryPolicy
}

/** What recall reads: the events a character took in and what it believes. */
export interface RecallSource {
  events: Pick<EventRepository, 'perceivedBy'>
  memories: Pick<MemoryRepository, 'list'>
}

/** Turns for the memory of an unimportant event to halve; each step of importance doubles it. */
const HALF_LIFE_TURNS = 6
/** Beliefs and what a character knows last longer than the memory of single events. */
const BELIEF_DURABILITY = 4
/** Each time something is recalled it lasts longer, up to this many times as long. */
const REHEARSAL_STEP = 0.25
const MAX_REHEARSAL = 2
/** What is left of a memory, from 1 (as it happened) to 0 (gone), above which it is clear, faded and vague. */
const CLEAR_ABOVE = 0.6
const FADED_ABOVE = 0.3
const VAGUE_ABOVE = 0.12
/** A cue in the situation brings back something that was fading. */
const CUE_BOOST = 0.25
/** What is that important stays faded at worst. */
const UNFORGETTABLE = 5

/** A number from 0 up to 1 that is always the same for the same input: no two memories fade at quite the same rate. */
export function jitter(seed: number): number {
  let h = (seed + 0x9e3779b9) >>> 0
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b) >>> 0
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) >>> 0
  return ((h ^ (h >>> 16)) >>> 0) / 0x100000000
}

/** What is left of a memory, from 1 down to 0, given its age, how much it matters and how often it was recalled. */
export function retention(input: { age: number; importance: number; recalls: number; seed: number; durability?: number; cue?: boolean }): number {
  const rehearsal = 1 + Math.min(MAX_REHEARSAL, input.recalls * REHEARSAL_STEP)
  const halfLife = HALF_LIFE_TURNS * 2 ** (input.importance - 1) * rehearsal * (input.durability ?? 1)
  const faded = 0.5 ** (Math.max(0, input.age) / halfLife) * (0.85 + 0.3 * jitter(input.seed))
  return Math.min(1, faded + (input.cue === true ? CUE_BOOST : 0))
}

/** How clear a memory is at a retention, or nothing when it is gone. */
export function clarityAt(value: number, importance: number): Clarity | undefined {
  if (value >= CLEAR_ABOVE) return 'clear'
  if (value >= FADED_ABOVE || importance >= UNFORGETTABLE) return 'faded'
  if (value >= VAGUE_ABOVE) return 'vague'
  return undefined
}

const CJK = /\p{Script=Han}|\p{Script=Hiragana}|\p{Script=Katakana}|\p{Script=Hangul}/u

/** Words a text can be matched by: words as they are, and overlapping pairs of characters for scripts written without spaces. */
export function tokens(text: string): Set<string> {
  const found = new Set<string>()
  for (const word of text.normalize('NFKC').toLowerCase().split(/[^\p{L}\p{N}]+/u)) {
    if (word === '') continue
    if (!CJK.test(word)) {
      if (word.length >= 3) found.add(word)
      continue
    }
    const chars = [...word]
    if (chars.length === 1) found.add(word)
    for (let index = 0; index + 1 < chars.length; index++) found.add(chars[index]! + chars[index + 1]!)
  }
  return found
}

/** The characters a text mentions by name or alias. */
export function mentioned(text: string, characters: readonly Character[]): Set<number> {
  const words = tokens(text)
  const lowered = text.normalize('NFKC').toLowerCase()
  const ids = new Set<number>()
  for (const character of characters) {
    for (const name of [character.name, ...character.aliases]) {
      const needle = name.normalize('NFKC').toLowerCase()
      if (needle.length >= 2 && (lowered.includes(needle) || tokens(needle).size > 0 && [...tokens(needle)].every(token => words.has(token)))) ids.add(character.id)
    }
  }
  return ids
}

interface Candidate {
  key: string
  recalled: Omit<Recalled, 'clarity' | 'text'> & { clear: string; faded: string; vague: string }
  relevance: number
  importance: number
  age: number
  recalls: number
  seed: number
  durability: number
}

const first = (text: string): string => {
  const match = /^[^.!?。！？]*[.!?。！？]?/u.exec(text.trim())
  const sentence = (match?.[0] ?? text).trim()
  return sentence === '' ? text.trim() : sentence
}

export function overlap(cues: ReadonlySet<string>, text: string, tags: readonly string[]): number {
  let score = 0
  for (const tag of tags) if (cues.has(tag.toLowerCase())) score += 2
  for (const token of tokens(text)) if (cues.has(token)) score += 1
  return Math.min(score, 6)
}

function describeEvent({ perception, event }: PerceivedEvent, names: ReadonlyMap<number, string>): Candidate['recalled'] {
  const who = event.involves.map(id => names.get(id)).filter((name): name is string => name !== undefined)
  const about = who.length > 0 ? who.join(', ') : event.tags.join(', ')
  return {
    turn: event.turn,
    source: { kind: 'perception', id: perception.id },
    clear: perception.content,
    faded: perception.gist,
    vague: about === '' ? 'something happened, but you cannot say what' : `something to do with ${about}`,
  }
}

function describeBelief(memory: CharacterMemory): Candidate['recalled'] {
  return { turn: memory.turn, source: { kind: 'memory', id: memory.id }, clear: memory.text, faded: first(memory.text), vague: first(memory.text) }
}

/** One thing a character could be reminded of, with the text to match it against the moment. */
export interface RecallCandidate {
  /** Names the candidate in the `semantic` scores given to {@link recall}: `p:<id>` for something it took in, `m:<id>` for something it believes. */
  key: string
  /** What the character remembers of it in full: what an embedding or a reranker should read. */
  text: string
  turn: number
  importance: number
}

/** What a semantic match is worth next to the cues: a perfect match counts as much as being named twice and sharing words. */
const SEMANTIC_WEIGHT = 6

function gather(source: RecallSource, { characterId, characters, situation, turn }: Pick<RecallQuery, 'characterId' | 'characters' | 'situation' | 'turn'>): Candidate[] {
  const names = new Map(characters.map(character => [character.id, character.name]))
  const peers = mentioned(situation, characters)
  peers.delete(characterId)
  const cues = tokens(situation)
  return [
    ...source.events.perceivedBy(characterId).map((seen): Candidate => ({
      key: `p:${seen.perception.id}`,
      recalled: describeEvent(seen, names),
      relevance: 3 * seen.event.involves.filter(id => peers.has(id)).length + overlap(cues, `${seen.perception.content} ${seen.event.text}`, seen.event.tags),
      importance: seen.event.importance,
      age: turn - seen.event.turn,
      recalls: seen.perception.recalls,
      seed: seen.perception.id,
      durability: 1,
    })),
    ...source.memories.list(characterId).map((belief): Candidate => ({
      key: `m:${belief.id}`,
      recalled: describeBelief(belief),
      relevance: 3 * belief.about.filter(id => peers.has(id)).length + overlap(cues, belief.text, []),
      importance: belief.importance,
      age: turn - belief.turn,
      recalls: belief.recalls,
      seed: 1_000_000 + belief.id,
      durability: BELIEF_DURABILITY,
    })),
  ]
}

/** Everything the character could be reminded of, for a caller that ranks by meaning (an embedding, a reranker) before asking for the recall. */
export function recallCandidates(source: RecallSource, query: Pick<RecallQuery, 'characterId' | 'characters' | 'situation' | 'turn'>): RecallCandidate[] {
  return gather(source, query).map(candidate => ({ key: candidate.key, text: candidate.recalled.clear, turn: candidate.recalled.turn, importance: candidate.importance }))
}

/**
 * Reminds a character of what the moment calls to mind: events it took in and things it
 * believes, chosen by who is mentioned, shared words, how much they matter and how recent
 * they are. With flaky memory on, how much of each comes back depends on its age and
 * importance, so old trivia is vague or gone and old things that mattered stay.
 *
 * `semantic` is how well each candidate matches the moment by meaning, from 0 to 1, by candidate
 * key, as an embedding or a reranker gives it; it adds to the cues, and a good match also
 * counts as a cue for what had faded. Without it the cues alone decide.
 */
export function recall(source: RecallSource, query: RecallQuery, semantic?: ReadonlyMap<string, number>): Recalled[] {
  const { policy } = query
  const candidates = gather(source, query).map(candidate => ({ ...candidate, relevance: candidate.relevance + SEMANTIC_WEIGHT * (semantic?.get(candidate.key) ?? 0) }))

  const scored = candidates.flatMap((candidate) => {
    let clarity: Clarity | undefined = 'clear'
    if (policy.flaky) {
      clarity = clarityAt(retention({ age: candidate.age, importance: candidate.importance, recalls: candidate.recalls, seed: candidate.seed, durability: candidate.durability, cue: candidate.relevance >= 2 }), candidate.importance)
    }
    if (clarity === undefined) return []
    const score = candidate.relevance + 0.6 * candidate.importance + 2 / (1 + Math.max(0, candidate.age) / 4) + (clarity === 'vague' ? -1 : 0)
    return [{ candidate, clarity, score, text: candidate.recalled[clarity === 'clear' ? 'clear' : clarity === 'faded' ? 'faded' : 'vague'] }]
  })
  return scored
    .sort((a, b) => b.score - a.score || b.candidate.recalled.turn - a.candidate.recalled.turn)
    .slice(0, policy.recall)
    .sort((a, b) => a.candidate.recalled.turn - b.candidate.recalled.turn)
    .map(({ candidate, clarity, text }) => ({ clarity, text, turn: candidate.recalled.turn, source: candidate.recalled.source }))
}
