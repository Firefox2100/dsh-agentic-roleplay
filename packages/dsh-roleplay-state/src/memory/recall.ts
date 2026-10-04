import type { Character, CharacterId, CharacterMemory, PerceivedEvent } from 'dsh-roleplay-model'
import type { EventRepository, MemoryRepository } from '../repositories.ts'

/** How a character remembers. */
export interface MemoryPolicy {
  /** Whether memories fade with age and unimportance. Off for exact recall. */
  flaky: boolean
  /** The most things a character is reminded of at once. */
  recall: number
  /**
   * How many times `recall` candidates are retrieved before the best are chosen: the wider net is what a
   * reranker judges, and it also gives importance and recency something to choose between. At least 1.
   */
  overRetrieve?: number
}

export const DEFAULT_MEMORY_POLICY: MemoryPolicy = { flaky: true, recall: 12, overRetrieve: 4 }

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
  /** Where the character is. What happened in the same place comes back to it more readily. */
  locationId?: number
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

/**
 * Retrieval is several searches (the cues of the moment, the words of the index, the meaning of the
 * stored vectors) that each score the candidates their own way. Each is brought to a score from 0 to 1
 * and the scores are fused by a weighted average over the searches that ran, so that a candidate one search
 * found and another did not is worth less than one both found; a search that found nothing takes no part,
 * so what is missing never counts against anything.
 */
const FUSION_WEIGHTS = { cues: 1, lexical: 1, dense: 1.5 } as const
/** Cues of the moment add up (a name counts 3, shared words up to 6, a place 2); this much is as good as a cue gets. */
const FULL_CUE = 6
/** What the fused retrieval score counts for next to how much a memory matters and how recent it is (up to about 2.6 and 2). */
const RELEVANCE_SCALE = 10
/** What a reranker's judgement counts for next to the fused retrieval score, when there is one. */
const RERANK_BLEND = 0.7
/** Retrieval is cut to this many candidates however wide the net, so that a reranker is never asked about more. */
const MAX_POOL = 60
/** What fused retrieval has to be for a match to count as a cue for what had faded. */
const CUE_RELEVANCE = 0.2
/** Cosine similarities below this are noise for the models used, and from here to this plus the range they count from nothing to full. */
const DENSE_FLOOR = 0.3
const DENSE_RANGE = 0.5

/** From a cosine similarity to how much a match counts, from 0 to 1. */
export const denseScore = (similarity: number): number => Math.min(1, Math.max(0, (similarity - DENSE_FLOOR) / DENSE_RANGE))

/** What else says how well each candidate matches the moment, by candidate key, each from 0 to 1. */
export interface RecallEvidence {
  /** From the search of the session's index by words. */
  lexical?: ReadonlyMap<string, number>
  /** From the search of the session's stored vectors by meaning, already mapped by {@link denseScore}. */
  dense?: ReadonlyMap<string, number>
  /** From a reranker that judged the candidates of the pool (see {@link poolCandidates}). */
  rerank?: ReadonlyMap<string, number>
}

/** Being where something happened calls it to mind, about as much as sharing two words with it. */
const PLACE_CUE = 2

function gather(source: RecallSource, { characterId, characters, situation, turn, locationId }: Pick<RecallQuery, 'characterId' | 'characters' | 'situation' | 'turn' | 'locationId'>): Candidate[] {
  const names = new Map(characters.map(character => [character.id, character.name]))
  const peers = mentioned(situation, characters)
  peers.delete(characterId)
  const cues = tokens(situation)
  return [
    ...source.events.perceivedBy(characterId).map((seen): Candidate => ({
      key: `p:${seen.perception.id}`,
      recalled: describeEvent(seen, names),
      relevance: 3 * seen.event.involves.filter(id => peers.has(id)).length + overlap(cues, `${seen.perception.content} ${seen.event.text}`, seen.event.tags)
        + (locationId !== undefined && seen.event.locationId === locationId ? PLACE_CUE : 0),
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
export function recallCandidates(source: RecallSource, query: Pick<RecallQuery, 'characterId' | 'characters' | 'situation' | 'turn' | 'locationId'>): RecallCandidate[] {
  return gather(source, query).map(candidate => ({ key: candidate.key, text: candidate.recalled.clear, turn: candidate.recalled.turn, importance: candidate.importance }))
}

/** Fuse scores from 0 to 1 into one, per key: the weighted average over the searches that ran (those with any score above 0). */
export function fuseScores(searches: readonly { weight: number; scores: ReadonlyMap<string, number> | undefined }[]): Map<string, number> {
  const ran = searches.filter(search => [...(search.scores ?? [])].some(([, score]) => score > 0))
  const total = ran.reduce((sum, search) => sum + search.weight, 0)
  const fused = new Map<string, number>()
  for (const { weight, scores } of ran) {
    for (const [key, score] of scores ?? []) fused.set(key, (fused.get(key) ?? 0) + weight * Math.min(1, Math.max(0, score)) / total)
  }
  return fused
}

interface PoolEntry {
  candidate: Candidate
  /** How well retrieval alone matches the moment, from 0 to 1. */
  fused: number
}

/** What retrieval over-retrieved for one recall, waiting for a reranker's judgement and the final choice. */
export interface RecallPool {
  entries: readonly PoolEntry[]
  query: Pick<RecallQuery, 'policy'>
}

/** How well a candidate stands once its relevance is known: what the moment calls to mind, how much it matters and how recent it is. */
function judged(candidate: Candidate, relevance: number, policy: MemoryPolicy): { clarity: Clarity; score: number; text: string } | undefined {
  let clarity: Clarity | undefined = 'clear'
  if (policy.flaky) {
    clarity = clarityAt(retention({ age: candidate.age, importance: candidate.importance, recalls: candidate.recalls, seed: candidate.seed, durability: candidate.durability, cue: relevance >= CUE_RELEVANCE }), candidate.importance)
  }
  if (clarity === undefined) return undefined
  const score = RELEVANCE_SCALE * relevance + 0.6 * candidate.importance + 2 / (1 + Math.max(0, candidate.age) / 4) + (clarity === 'vague' ? -1 : 0)
  return { clarity, score, text: candidate.recalled[clarity === 'clear' ? 'clear' : clarity === 'faded' ? 'faded' : 'vague'] }
}

/**
 * The first stage of reminding a character of what the moment calls to mind: retrieve, by the cues
 * of the moment (who is named, shared words and tags, where it happened), by the words of the index
 * and by meaning, fuse the scores of each, and keep more than will be used (`policy.overRetrieve` times
 * `policy.recall`, the best by fused relevance together with how much each matters and how recent it
 * is, and not what has faded from memory altogether). A reranker may then judge that pool.
 */
export function recallPool(source: RecallSource, query: RecallQuery, evidence: Omit<RecallEvidence, 'rerank'> = {}): RecallPool {
  const { policy } = query
  const candidates = gather(source, query)
  const fused = fuseScores([
    { weight: FUSION_WEIGHTS.cues, scores: new Map(candidates.map(candidate => [candidate.key, candidate.relevance / FULL_CUE])) },
    { weight: FUSION_WEIGHTS.lexical, scores: evidence.lexical },
    { weight: FUSION_WEIGHTS.dense, scores: evidence.dense },
  ])
  const width = Math.min(MAX_POOL, Math.max(policy.recall, Math.ceil(policy.recall * Math.max(1, policy.overRetrieve ?? 1))))
  const entries = candidates
    .map(candidate => ({ candidate, fused: fused.get(candidate.key) ?? 0 }))
    .flatMap((entry) => {
      const standing = judged(entry.candidate, entry.fused, policy)
      return standing === undefined ? [] : [{ entry, score: standing.score }]
    })
    .sort((a, b) => b.score - a.score || b.entry.candidate.recalled.turn - a.entry.candidate.recalled.turn)
    .slice(0, width)
    .map(({ entry }) => entry)
  return { entries, query: { policy } }
}

/** What a reranker is asked to judge: every candidate of the pool, with the text it would be recalled by. */
export function poolCandidates(pool: RecallPool): RecallCandidate[] {
  return pool.entries.map(({ candidate }) => ({ key: candidate.key, text: candidate.recalled.clear, turn: candidate.recalled.turn, importance: candidate.importance }))
}

/**
 * The last stage: choose the `policy.recall` best of the pool. With a reranker's judgement each
 * candidate's relevance is mostly that (a candidate it left out counts as 0), and the rest is what
 * retrieval found; without, it is what retrieval found.
 */
export function finishRecall(pool: RecallPool, rerank?: ReadonlyMap<string, number>): Recalled[] {
  const { policy } = pool.query
  return pool.entries
    .flatMap(({ candidate, fused }) => {
      const relevance = rerank === undefined ? fused : RERANK_BLEND * Math.min(1, Math.max(0, rerank.get(candidate.key) ?? 0)) + (1 - RERANK_BLEND) * fused
      const standing = judged(candidate, relevance, policy)
      return standing === undefined ? [] : [{ candidate, ...standing }]
    })
    .sort((a, b) => b.score - a.score || b.candidate.recalled.turn - a.candidate.recalled.turn)
    .slice(0, policy.recall)
    .sort((a, b) => a.candidate.recalled.turn - b.candidate.recalled.turn)
    .map(({ candidate, clarity, text }) => ({ clarity, text, turn: candidate.recalled.turn, source: candidate.recalled.source }))
}

/** Remind a character of what the moment calls to mind, in one call: {@link recallPool}, then {@link finishRecall} with the `rerank` evidence if there is any. */
export function recall(source: RecallSource, query: RecallQuery, evidence: RecallEvidence = {}): Recalled[] {
  return finishRecall(recallPool(source, query, evidence), evidence.rerank)
}
