import type { Agent } from '@deepseek-ai/dsh-agent'
import type { ObjectJsonSchema } from '@deepseek-ai/dsh-tools'
import type { DecisionService } from '@dsh-ai-providers/core'
import { characterKey, tokens, type RecordsEdit, type Session } from '@dsh-agentic-roleplay/state'
import { IMPORTANCE_MAX, IMPORTANCE_MIN, MEMORY_CONFIDENCES, MEMORY_KINDS, languageOf, translator, type Character, type CharacterMemory, type Location, type MemoryConfidence, type MemoryKind, type PerceivedEvent, type Translate } from 'dsh-roleplay-model'
import type { SiteReport } from '../../shared/decisions.ts'
import type { ReflectionOutcome, ReflectionReason, ReflectionStatus } from '../../shared/reflection.ts'
import { announceProblem, askYesNo, mergeReports, noAt, routeVerdicts, yesAt } from '../decisions/route.ts'
import { wrongLanguage } from '../translate/language.ts'
import { estimateAnswer } from '../agents/budget.ts'
import { childModel, childSampling, childTrace, runChild } from '../agents/child.ts'
import { describeWhen } from '../clock/story-clock.ts'
import { promptFor } from '../prompts/access.ts'
import type { Reflector, TurnStore } from '../orchestration/boundaries.ts'
import { referent } from '../orchestration/referent.ts'
import { sameScene } from '../orchestration/whereabouts.ts'

const LAST_KEY = 'reflection.last'
const CURSOR_KEY = 'reflection.cursor'
const ANCHOR_KEY = 'reflection.anchor'
const ERROR_KEY = 'reflection.error'
const DAY_MS = 24 * 60 * 60 * 1000
const MAX_MATERIAL = 40
const MAX_BELIEFS_SHOWN = 40
const MAX_ADDED = 4
const MAX_CHANGES = 10
const MAX_TEXT = 300
/** An event this important is reason enough for a belief on its own. */
const DECISIVE_IMPORTANCE = 4

type ReflectionSession = Pick<Session, 'metadata' | 'characters' | 'events' | 'memories' | 'locations' | 'clock' | 'edit' | 'transaction'>

type Last = NonNullable<ReflectionStatus['last']>
interface Anchor { place?: number; now: number }

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)

function readLast(session: Pick<Session, 'metadata'>): Last | undefined {
  const stored = session.metadata.getValue(LAST_KEY)
  return isRecord(stored) && typeof stored['turn'] === 'number' ? stored as unknown as Last : undefined
}

function readCursor(session: Pick<Session, 'metadata'>): Record<string, number> {
  const stored = session.metadata.getValue(CURSOR_KEY)
  return isRecord(stored) ? Object.fromEntries(Object.entries(stored).filter((entry): entry is [string, number] => typeof entry[1] === 'number')) : {}
}

function readAnchor(session: Pick<Session, 'metadata'>): Anchor | undefined {
  const stored = session.metadata.getValue(ANCHOR_KEY)
  return isRecord(stored) && typeof stored['now'] === 'number' ? { now: stored['now'], ...(typeof stored['place'] === 'number' ? { place: stored['place'] } : {}) } : undefined
}

function writeAnchor(session: Pick<Session, 'metadata'>, place: Location | undefined, now: number): void {
  session.metadata.setValue(ANCHOR_KEY, { now, ...(place === undefined ? {} : { place: place.id }) })
}

const playerPlace = (store: TurnStore): Location | undefined => store.cast().find(member => member.character.control === 'player')?.place?.location

/** What is known of the story's reflection: whether a pass runs, the latest that finished, and why the latest failed. */
export function reflectionStatus(session: Pick<Session, 'metadata'>, running: boolean): ReflectionStatus {
  const last = readLast(session)
  const failure = session.metadata.getValue(ERROR_KEY)
  return {
    running,
    ...(last === undefined ? {} : { last }),
    ...(isRecord(failure) && typeof failure['message'] === 'string' && typeof failure['at'] === 'string' ? { error: { at: failure['at'], message: failure['message'] } } : {}),
  }
}

export function recordFailure(session: Pick<Session, 'metadata'>, message: string): void {
  session.metadata.setValue(ERROR_KEY, { at: new Date().toISOString(), message: message.slice(0, 500) })
}

/**
 * Whether the story should reflect after this turn, and why. A pass waits until `minTurns` turns have passed since the last one; then it
 * comes after `everyTurns` turns, or when the scene has changed since the last pass (the player's character is somewhere that is neither
 * where it was nor inside or around it, or `sceneDays` of story time have passed). The first look only notes where the story stands.
 */
export function dueReflection(store: TurnStore, turn: number): Exclude<ReflectionReason, 'manual'> | undefined {
  const { reflection } = store.settings()
  if (!reflection.auto) return undefined
  const session = store.story
  const { now } = store.time(turn)
  const here = playerPlace(store)
  const anchor = readAnchor(session)
  if (anchor === undefined) { writeAnchor(session, here, now); return undefined }
  const since = turn - (readLast(session)?.turn ?? 0)
  if (since < reflection.minTurns) return undefined
  if (reflection.everyTurns > 0 && since >= reflection.everyTurns) return 'turns'
  if (!reflection.onSceneChange) return undefined
  const places = session.locations.list()
  const before = places.find(place => place.id === anchor.place)
  if (here !== undefined && before !== undefined && !sameScene(here, before, places)) return 'scene'
  if (reflection.sceneDays > 0 && now - anchor.now >= reflection.sceneDays * DAY_MS) return 'scene'
  return undefined
}

export interface Material {
  character: Character
  /** What it took in since the last pass, oldest first. */
  fresh: PerceivedEvent[]
  /** What it believes now, the most important first. */
  beliefs: CharacterMemory[]
}

/**
 * The characters that have enough new to sort, the most first. Only what the story has made final counts, and only up to the first thing
 * still a draft, so that nothing is passed over that is sealed later.
 */
export function materialOf(session: ReflectionSession, minNew: number): Material[] {
  const cursor = readCursor(session)
  const found: Material[] = []
  for (const character of session.characters.list()) {
    if (character.control !== 'agent' || character.kind !== 'person' || character.tier === 'background') continue
    const taken = session.events.perceivedBy(character.id)
    const draft = taken.filter(entry => !entry.event.sealed).map(entry => entry.perception.id)
    const ceiling = draft.length === 0 ? Infinity : Math.min(...draft) - 1
    const fresh = taken
      .filter(entry => entry.event.sealed && entry.perception.id > (cursor[characterKey(character)] ?? 0) && entry.perception.id <= ceiling)
      .sort((a, b) => a.perception.id - b.perception.id)
      .slice(0, MAX_MATERIAL)
    if (fresh.length < minNew) continue
    const beliefs = session.memories.list(character.id).sort((a, b) => b.importance - a.importance || a.id - b.id).slice(0, MAX_BELIEFS_SHOWN)
    found.push({ character, fresh, beliefs })
  }
  return found.sort((a, b) => b.fresh.length - a.fresh.length)
}

export interface Proposal {
  add: { kind: string; text: string; about?: string[]; importance: number; confidence?: MemoryConfidence; perceptions?: number[]; beliefs?: number[] }[]
  revise: { id: number; text?: string; importance?: number; confidence?: MemoryConfidence; perceptions?: number[]; contradicted_by?: number[] }[]
  /** Beliefs that something since speaks against: they are held with more doubt, and what speaks against them is linked. */
  doubt?: { id: number; contradicted_by: number[]; text?: string }[]
  drop: { id: number; perceptions?: number[]; merged_into?: number }[]
}

const idList = { type: 'array', items: { type: 'integer' } } as const

const RESULT: ObjectJsonSchema = {
  type: 'object',
  properties: {
    add: {
      type: 'array',
      description: 'New beliefs, at most four. Leave empty when nothing new can be firmly said.',
      items: {
        type: 'object',
        properties: {
          kind: { type: 'string', enum: [...MEMORY_KINDS], description: 'belief: what it holds true or suspects; relationship: how it stands with someone; knowledge: something it knows.' },
          text: { type: 'string', description: 'What the character believes, in one or two sentences, in its own terms. Say plainly when it is a suspicion, a rumour or a guess.' },
          about: { type: 'array', items: { type: 'string' }, description: 'The names of the characters it is about.' },
          importance: { type: 'integer', description: `From ${IMPORTANCE_MIN} (passing) to ${IMPORTANCE_MAX} (it shapes how they act).` },
          confidence: { type: 'string', enum: [...MEMORY_CONFIDENCES], description: 'How sure they are: doubtful, likely (when you leave it out) or sure, which needs things from at least two different turns.' },
          perceptions: { ...idList, description: 'The numbers of the things it took in that this rests on.' },
          beliefs: { ...idList, description: 'The numbers of the beliefs it generalises or builds on, if any.' },
        },
        required: ['kind', 'text', 'importance', 'perceptions'],
        additionalProperties: false,
      },
    },
    revise: {
      type: 'array',
      description: 'Beliefs to firm up, doubt or correct in the light of what came after them.',
      items: {
        type: 'object',
        properties: {
          id: { type: 'integer', description: 'The number of the belief, as listed.' },
          text: { type: 'string', description: 'The belief as it should read now.' },
          importance: { type: 'integer', description: `From ${IMPORTANCE_MIN} to ${IMPORTANCE_MAX}.` },
          confidence: { type: 'string', enum: [...MEMORY_CONFIDENCES], description: 'How sure they are now. Raise it only for what supports the belief; lower it only together with contradicted_by.' },
          perceptions: { ...idList, description: 'The numbers of the things it took in since that support the belief or bear on it.' },
          contradicted_by: { ...idList, description: 'The numbers of the things it took in since that speak against the belief; the belief is then doubted, and its confidence must be lowered.' },
        },
        required: ['id'],
        additionalProperties: false,
      },
    },
    doubt: {
      type: 'array',
      description: 'Beliefs that something the character took in since speaks against, which it still holds but with more doubt: name the belief and the numbers of what speaks against it, and its confidence is lowered for you. This is the way to answer a belief that a later event contradicts, instead of revising or dropping it.',
      items: {
        type: 'object',
        properties: {
          id: { type: 'integer', description: 'The number of the belief, as listed.' },
          contradicted_by: { ...idList, description: 'The numbers of the things it took in since that speak against the belief.' },
          text: { type: 'string', description: 'The belief reworded to say what is now in doubt, when its words need it; one or two sentences, and nothing but the belief: its confidence and the numbers are not part of the text.' },
        },
        required: ['id', 'contradicted_by'],
        additionalProperties: false,
      },
    },
    drop: {
      type: 'array',
      description: 'Beliefs to let go: settled or overturned by what came after, or merged into another.',
      items: {
        type: 'object',
        properties: {
          id: { type: 'integer' },
          perceptions: { ...idList, description: 'What it took in since that settles or overturns it.' },
          merged_into: { type: 'integer', description: 'The number of the belief that now says the same, instead of a reason from what it took in.' },
        },
        required: ['id'],
        additionalProperties: false,
      },
    },
  },
  required: ['add', 'revise', 'drop'],
  additionalProperties: false,
}

export interface Shown {
  perceptions: ReadonlyMap<number, PerceivedEvent>
  beliefs: ReadonlyMap<number, CharacterMemory>
  /** The turns of the events each belief's supporting perceptions are of. */
  supportTurns?: ReadonlyMap<number, ReadonlySet<number>>
}

function shownOf(session: ReflectionSession, material: Material): Shown {
  const turnOf = (perceptionId: number): number | undefined => { const seen = session.events.getPerception(perceptionId); return seen === undefined ? undefined : session.events.get(seen.eventId)?.turn }
  return {
    perceptions: new Map(material.fresh.map(entry => [entry.perception.id, entry])),
    beliefs: new Map(material.beliefs.map(belief => [belief.id, belief])),
    supportTurns: new Map(material.beliefs.map(belief => [belief.id, new Set(session.memories.evidenceOf(belief.id).filter(entry => entry.relation === 'supports').flatMap(entry => turnOf(entry.perceptionId) ?? []))])),
  }
}

const rankOf = (confidence: MemoryConfidence): number => MEMORY_CONFIDENCES.indexOf(confidence)

function perceptionCitation(text: string, bracketRequired: boolean): boolean {
  const lower = text.toLowerCase()
  let from = 0
  while (from < lower.length) {
    const at = lower.indexOf('perception', from)
    if (at < 0) return false
    let end = at + 'perception'.length
    if (lower[end] === 's') end += 1
    while (/\s/u.test(lower[end] ?? '')) end += 1
    const bracket = lower[end] === '['
    if (bracket) end += 1
    if ((!bracketRequired || bracket) && /\d/u.test(lower[end] ?? '')) return true
    from = at + 1
  }
  return false
}

/** What a model writes into a belief's text when it has not put it in the fields: its confidence, importance or the numbers it rests on. */
function mixedIntoText(text: string): boolean {
  if (perceptionCitation(text, true)) return true
  let from = 0
  while (from < text.length) {
    const open = text.indexOf('(', from)
    if (open < 0) return false
    const close = text.indexOf(')', open + 1)
    if (close < 0) return false
    const inside = text.slice(open + 1, close)
    const words = inside.toLowerCase().split(/[^a-z]+/).filter(Boolean)
    if (words.some(word => ['doubtful', 'likely', 'sure', 'importance'].includes(word)) || perceptionCitation(inside, false)) return true
    from = close + 1
  }
  return false
}

/** One step less sure, and no less than doubtful. */
const lowered = (confidence: MemoryConfidence): MemoryConfidence => MEMORY_CONFIDENCES[Math.max(0, rankOf(confidence) - 1)]!

/**
 * Why a proposal cannot be written, or nothing when it can. A belief must rest on what the character took in: on things from at least two
 * different turns, or on one event that turned the story; a belief is changed or let go only for what came after it, or for being merged
 * into another. Nothing is judged about whether the belief is wise; only whether it is grounded in what the character was given.
 */
export function proposalProblems(proposal: Proposal, shown: Shown, resolveName: (name: string) => string | undefined, tr: Translate = translator('en')): string[] {
  const problems: string[] = []
  const add = proposal.add ?? []
  const revise = proposal.revise ?? []
  const drop = proposal.drop ?? []
  const doubt = proposal.doubt ?? []
  if (add.length > MAX_ADDED) problems.push(tr('add: at most {max} new beliefs in one pass; merge or choose', { max: MAX_ADDED }))
  if (add.length + revise.length + drop.length + doubt.length > MAX_CHANGES) problems.push(tr('at most {max} changes in one pass', { max: MAX_CHANGES }))
  const cited = (ids: readonly number[] | undefined, where: string): PerceivedEvent[] => (ids ?? []).flatMap((id) => {
    const entry = shown.perceptions.get(id)
    if (entry === undefined) problems.push(tr('{where}: there is no thing it took in numbered {id}', { where, id }))
    return entry === undefined ? [] : [entry]
  })
  const known = (value: unknown, where: string): value is MemoryConfidence | undefined => {
    const fine = value === undefined || MEMORY_CONFIDENCES.includes(value as MemoryConfidence)
    if (!fine) problems.push(tr('{where}: confidence is one of {options}', { where, options: MEMORY_CONFIDENCES.join(', ') }))
    return fine
  }
  add.forEach((belief, index) => {
    const where = `add[${index}]`
    if (!MEMORY_KINDS.includes(belief.kind as MemoryKind)) problems.push(tr('{where}: unknown kind "{kind}"', { where, kind: belief.kind }))
    if (belief.text.trim() === '') problems.push(tr('{where}: say what it believes', { where }))
    else if (belief.text.trim().length > MAX_TEXT) problems.push(tr('{where}: at most {max} characters; say it shorter', { where, max: MAX_TEXT }))
    if (!Number.isInteger(belief.importance) || belief.importance < IMPORTANCE_MIN || belief.importance > IMPORTANCE_MAX) problems.push(tr('{where}: importance runs from {min} to {max}', { where, min: IMPORTANCE_MIN, max: IMPORTANCE_MAX }))
    const sure = known(belief.confidence, where) && belief.confidence === 'sure'
    const events = cited(belief.perceptions, where)
    const built = (belief.beliefs ?? []).flatMap((id) => {
      const found = shown.beliefs.get(id)
      if (found === undefined) problems.push(tr('{where}: there is no belief numbered {id}', { where, id }))
      return found === undefined ? [] : [found]
    })
    const turns = new Set([...events.map(entry => entry.event.turn), ...built.map(found => found.turn)])
    if (turns.size < 2 && !events.some(entry => entry.event.importance >= DECISIVE_IMPORTANCE)) problems.push(tr('{where}: one passing moment is not yet a belief; rest it on things from at least two different turns, or on one event that turned the story', { where }))
    if (sure && turns.size < 2) problems.push(tr('{where}: to be sure of something it must rest on things from at least two different turns', { where }))
    for (const name of belief.about ?? []) if (resolveName(name) === undefined) problems.push(tr('{where}: "{name}" is not a character; name them as they are named', { where, name }))
  })
  const touched = new Set<number>()
  const touch = (id: number, where: string): void => {
    if (touched.has(id)) problems.push(tr('{where}: belief {id} is already changed in this pass', { where, id }))
    touched.add(id)
  }
  const fresh = (events: PerceivedEvent[], belief: CharacterMemory, where: string): void => {
    if (events.length === 0) problems.push(tr('{where}: say what it took in since that bears on it', { where }))
    for (const entry of events) if (entry.event.turn < belief.turn) problems.push(tr('{where}: thing {id} came before the belief was formed; cite what came after', { where, id: entry.perception.id }))
  }
  revise.forEach((change, index) => {
    const where = `revise[${index}]`
    const belief = shown.beliefs.get(change.id)
    if (belief === undefined) { problems.push(tr('{where}: there is no belief numbered {id}', { where, id: change.id })); return }
    touch(change.id, where)
    const supports = cited(change.perceptions, where)
    const against = cited(change.contradicted_by, where)
    if (change.text === undefined && change.importance === undefined && change.confidence === undefined && against.length === 0) problems.push(tr('{where}: say what changes', { where }))
    if (change.text !== undefined && change.text.trim().length > MAX_TEXT) problems.push(tr('{where}: the text is longer than {max} characters. A belief is not rewritten to hold what speaks against it: leave the text out and list the belief under doubt with the numbers of what speaks against it, and put what was learned as a new belief of its own', { where, max: MAX_TEXT }))
    else if (change.text !== undefined && change.text.trim() === '') problems.push(tr('{where}: the text must be there and at most {max} characters; leave it out to keep the belief as it is', { where, max: MAX_TEXT }))
    if (change.text !== undefined && mixedIntoText(change.text)) problems.push(tr('{where}: the confidence, the importance and the numbers are fields of their own, not part of the text', { where }))
    if (change.importance !== undefined && (!Number.isInteger(change.importance) || change.importance < IMPORTANCE_MIN || change.importance > IMPORTANCE_MAX)) problems.push(tr('{where}: importance runs from {min} to {max}', { where, min: IMPORTANCE_MIN, max: IMPORTANCE_MAX }))
    fresh([...supports, ...against], belief, where)
    if (!known(change.confidence, where) || change.confidence === undefined) {
      if (against.length > 0) problems.push(tr('{where}: a belief that something contradicts must be doubted: lower its confidence', { where }))
      return
    }
    if (against.length > 0 && rankOf(change.confidence) >= rankOf(belief.confidence)) problems.push(tr('{where}: a belief that something contradicts must be doubted: lower its confidence', { where }))
    if (against.length === 0 && rankOf(change.confidence) < rankOf(belief.confidence)) problems.push(tr('{where}: to doubt a belief, name what contradicts it in contradicted_by', { where }))
    if (change.confidence === 'sure' && belief.confidence !== 'sure') {
      const turns = new Set([...(shown.supportTurns?.get(belief.id) ?? []), ...supports.map(entry => entry.event.turn)])
      if (turns.size < 2) problems.push(tr('{where}: to be sure of something it must rest on things from at least two different turns', { where }))
    }
  })
  doubt.forEach((change, index) => {
    const where = `doubt[${index}]`
    const belief = shown.beliefs.get(change.id)
    if (belief === undefined) { problems.push(tr('{where}: there is no belief numbered {id}', { where, id: change.id })); return }
    touch(change.id, where)
    const against = cited(change.contradicted_by, where)
    if (against.length === 0) problems.push(tr('{where}: name what speaks against the belief in contradicted_by', { where }))
    fresh(against, belief, where)
    if (change.text !== undefined && (change.text.trim() === '' || change.text.trim().length > MAX_TEXT)) problems.push(tr('{where}: the text must be there and at most {max} characters; leave it out to keep the belief as it is', { where, max: MAX_TEXT }))
    if (change.text !== undefined && mixedIntoText(change.text)) problems.push(tr('{where}: the confidence, the importance and the numbers are fields of their own, not part of the text', { where }))
  })
  const dropped = new Set(drop.map(entry => entry.id))
  drop.forEach((change, index) => {
    const where = `drop[${index}]`
    const belief = shown.beliefs.get(change.id)
    if (belief === undefined) { problems.push(tr('{where}: there is no belief numbered {id}', { where, id: change.id })); return }
    touch(change.id, where)
    if (change.merged_into !== undefined) {
      if (change.merged_into === change.id || !shown.beliefs.has(change.merged_into) || dropped.has(change.merged_into)) problems.push(tr('{where}: merge into a belief that stays', { where }))
      return
    }
    fresh(cited(change.perceptions, where), belief, where)
  })
  return problems
}

/**
 * The proposal with its mechanical mistakes mended instead of refused: things cited that were not shown, beliefs that do not exist, names that are
 * not characters, confidence the evidence cannot carry, changes that name a belief twice, and new beliefs that rest on one passing moment. A model
 * that is refused such a thing sends it again, five times, and the pass is lost; mended, the proposal is what the refusal would have asked for.
 * What needs the model's judgment (the words of a belief, what it rests on when nothing valid is left) is still refused by `proposalProblems`.
 */
/** A text cut to the limit at the end of a sentence, or failing that at a word. */
function shortened(text: string): string {
  const trimmed = text.trim()
  if (trimmed.length <= MAX_TEXT) return trimmed
  const head = trimmed.slice(0, MAX_TEXT)
  const sentence = Math.max(head.lastIndexOf('. '), head.lastIndexOf('! '), head.lastIndexOf('? '), head.lastIndexOf('。'), head.lastIndexOf('！'), head.lastIndexOf('？'))
  if (sentence >= MAX_TEXT / 3) return head.slice(0, sentence + 1).trim()
  const word = head.lastIndexOf(' ')
  return (word >= MAX_TEXT / 2 ? head.slice(0, word) : head.slice(0, MAX_TEXT - 1)).trim() + '…'
}

/** What a rewrite of an existing belief keeps of its text: nothing when it is too long, because a belief is doubted for what speaks against it, not rewritten. */
const keptText = (text: string | undefined): { text?: string } => (text === undefined || text.trim() === '' || text.trim().length > MAX_TEXT ? {} : { text })

export function settleProposal(proposal: Proposal, shown: Shown, resolveName: (name: string) => string | undefined): Proposal {
  const known = (ids: readonly number[] | undefined): number[] => [...new Set(ids ?? [])].filter(id => shown.perceptions.has(id))
  const after = (ids: readonly number[] | undefined, belief: CharacterMemory): number[] => known(ids).filter(id => shown.perceptions.get(id)!.event.turn >= belief.turn)
  const turnsOf = (ids: readonly number[], built: readonly CharacterMemory[]): Set<number> => new Set([...ids.map(id => shown.perceptions.get(id)!.event.turn), ...built.map(found => found.turn)])
  const decisive = (ids: readonly number[]): boolean => ids.some(id => shown.perceptions.get(id)!.event.importance >= DECISIVE_IMPORTANCE)
  const clamp = (importance: number): number => Math.min(IMPORTANCE_MAX, Math.max(IMPORTANCE_MIN, Math.round(importance)))
  const add = (proposal.add ?? []).flatMap((belief): Proposal['add'] => {
    if (typeof belief.text !== 'string' || belief.text.trim() === '') return []
    const perceptions = known(belief.perceptions)
    const built = [...new Set(belief.beliefs ?? [])].flatMap(id => shown.beliefs.get(id) ?? [])
    const turns = turnsOf(perceptions, built)
    if (turns.size < 2 && !decisive(perceptions)) return []
    const about = (belief.about ?? []).filter(name => resolveName(name) !== undefined)
    const { confidence: _confidence, ...rest } = belief
    const confidence = belief.confidence === 'sure' && turns.size < 2 ? 'likely' : belief.confidence
    return [{ ...rest, text: shortened(belief.text), kind: MEMORY_KINDS.includes(belief.kind as MemoryKind) ? belief.kind : 'belief', importance: clamp(belief.importance), perceptions, beliefs: built.map(found => found.id), about, ...(confidence === undefined ? {} : { confidence }) }]
  }).slice(0, MAX_ADDED)
  const taken = new Set<number>()
  const fresh = <T extends { id: number }>(changes: readonly T[] | undefined, mend: (change: T, belief: CharacterMemory) => T | undefined): T[] => (changes ?? []).flatMap((change) => {
    const belief = shown.beliefs.get(change.id)
    if (belief === undefined || taken.has(change.id)) return []
    const mended = mend(change, belief)
    if (mended !== undefined) taken.add(change.id)
    return mended === undefined ? [] : [mended]
  })
  const doubt = fresh(proposal.doubt, (change, belief) => {
    const against = after(change.contradicted_by, belief)
    const { text: _text, ...rest } = change
    return against.length === 0 ? undefined : { ...rest, ...keptText(change.text), contradicted_by: against }
  })
  const revise = fresh(proposal.revise, (change, belief) => {
    const supports = after(change.perceptions, belief)
    const against = after(change.contradicted_by, belief)
    const { confidence, text: _text, ...rest } = change
    let mended = confidence
    if (confidence !== undefined && !MEMORY_CONFIDENCES.includes(confidence)) mended = undefined
    else if (confidence !== undefined && against.length > 0 && rankOf(confidence) >= rankOf(belief.confidence)) mended = lowered(belief.confidence)
    else if (confidence !== undefined && against.length === 0 && rankOf(confidence) < rankOf(belief.confidence)) mended = undefined
    else if (confidence === 'sure' && belief.confidence !== 'sure' && new Set([...(shown.supportTurns?.get(belief.id) ?? []), ...supports.map(id => shown.perceptions.get(id)!.event.turn)]).size < 2) mended = undefined
    const result = { ...rest, ...keptText(change.text), perceptions: supports, contradicted_by: against, ...(mended === undefined ? {} : { confidence: mended }), ...(change.importance === undefined ? {} : { importance: clamp(change.importance) }) }
    return result.text === undefined && result.importance === undefined && result.confidence === undefined && against.length === 0 ? undefined : result
  })
  const drop = fresh(proposal.drop, (change, belief) => {
    if (change.merged_into !== undefined && change.merged_into !== change.id && shown.beliefs.has(change.merged_into) && !(proposal.drop ?? []).some(other => other.id === change.merged_into)) return { id: change.id, merged_into: change.merged_into }
    const settled = after(change.perceptions, belief)
    return settled.length === 0 ? undefined : { id: change.id, perceptions: settled }
  })
  const room = Math.max(0, MAX_CHANGES - add.length)
  const changes = [...revise.map(change => ['revise', change] as const), ...doubt.map(change => ['doubt', change] as const), ...drop.map(change => ['drop', change] as const)].slice(0, room)
  const only = <K extends 'revise' | 'doubt' | 'drop'>(kind: K) => changes.filter(entry => entry[0] === kind).map(entry => entry[1])
  return { add, revise: only('revise') as Proposal['revise'], doubt: only('doubt') as NonNullable<Proposal['doubt']>, drop: only('drop') as Proposal['drop'] }
}

/** A belief that something taken in since cannot be true together with, as the check of it found. */
export interface Contradiction { belief: number; things: number[] }

/**
 * The proposal with every contradiction the checks found doubted. What the proposal itself does to such a belief (revise, doubt or drop it) is replaced by
 * the doubt: a belief that something contradicts is not rewritten or let go in the same pass, and what was learned stays in the new beliefs it adds.
 */
export function withDoubts(proposal: Proposal, found: readonly Contradiction[]): Proposal {
  if (found.length === 0) return proposal
  const doubted = new Set(found.map(entry => entry.belief))
  const kept = <T extends { id: number }>(changes: readonly T[] | undefined): T[] => (changes ?? []).filter(change => !doubted.has(change.id))
  return { ...proposal, revise: kept(proposal.revise), drop: kept(proposal.drop), doubt: [...kept(proposal.doubt), ...found.map(entry => ({ id: entry.belief, contradicted_by: entry.things }))] }
}

const keysOf = (names: readonly string[] | undefined, resolveName: (name: string) => string | undefined): string[] => (names ?? []).flatMap((name) => { const key = resolveName(name); return key === undefined ? [] : [key] })

/** The edit that writes a proposal that passed. */
export function editOf(turn: number, character: Character, proposal: Proposal, resolveName: (name: string) => string | undefined, confidenceOf: (belief: number) => MemoryConfidence | undefined = () => undefined): RecordsEdit {
  const who = characterKey(character)
  return {
    turn,
    beliefs: (proposal.add ?? []).map(belief => ({ character: who, kind: belief.kind as MemoryKind, text: belief.text.trim(), about: keysOf(belief.about, resolveName), importance: belief.importance, ...(belief.confidence === undefined ? {} : { confidence: belief.confidence }), evidenceFor: belief.perceptions ?? [] })),
    beliefEdits: [...(proposal.revise ?? []), ...(proposal.doubt ?? []).map(change => ({ id: change.id, ...(change.text === undefined ? {} : { text: change.text }), confidence: lowered(confidenceOf(change.id) ?? 'likely'), contradicted_by: change.contradicted_by }))].map(change => ({ id: change.id, ...(change.text === undefined ? {} : { text: change.text.trim() }), ...('importance' in change && change.importance !== undefined ? { importance: change.importance } : {}), ...(change.confidence === undefined ? {} : { confidence: change.confidence }), evidenceFor: 'perceptions' in change ? change.perceptions ?? [] : [], evidenceAgainst: change.contradicted_by ?? [] })),
    beliefRetractions: (proposal.drop ?? []).map(change => change.id),
  }
}

/** The most things a belief is pointed at: the model checks a few against it, not everything. */
const MAX_BEARING = 4

/** How many words, besides these, a belief and a thing taken in must share for one to be pointed at the other. */
const SHARED_WORDS = 2
const FUNCTION_WORDS = new Set('the and that with have has had from which they them their this these those were was been being are for not but you your our his her its who whom what when where why how into onto about after before over under then than there here would could should will just also only some any all out too very can may might must did does done doing got get'.split(' '))

/**
 * What the character took in since that bears on a belief, which is where a contradiction is found: a model told only to look for one rationalises, but
 * one pointed at the few things about the same subject compares them. A thing bears on a belief when its event involves the people the belief is about,
 * or when it shares words with the belief (beliefs are often about a subject and no one in particular).
 */
export function bearingOn(belief: CharacterMemory, fresh: readonly PerceivedEvent[]): number[] {
  const people = fresh.filter(entry => belief.about.length > 0 && entry.event.involves.some(id => belief.about.includes(id))).slice(-MAX_BEARING)
  const own = [...tokens(belief.text)].filter(token => !FUNCTION_WORDS.has(token))
  const chosen = new Set(people.map(entry => entry.perception.id))
  const alike = fresh
    .map((entry) => { const words = tokens(entry.perception.content); return { id: entry.perception.id, shared: own.filter(token => words.has(token)).length } })
    .filter(entry => entry.shared >= SHARED_WORDS && !chosen.has(entry.id))
    .sort((a, b) => b.shared - a.shared || b.id - a.id)
    .slice(0, MAX_BEARING - chosen.size)
  return [...chosen, ...alike.map(entry => entry.id)].sort((x, y) => x - y)
}

/** The most beliefs of one character checked against what bears on them in one pass: each is a request of its own. */
const MAX_CHECKS = 6
/** The fewest things taken in that a failed sorting is tried again with half of. */
const MIN_TO_HALVE = 8

const CHECK_RESULT: ObjectJsonSchema = {
  type: 'object',
  properties: {
    reason: { type: 'string', description: 'One short sentence, written first, without quotation marks: what the belief claims and what the things say, side by side, and whether they can all be true together.' },
    things: { ...idList, description: 'The numbers of the things that cannot be true together with the belief; none when they all can be.' },
    verdict: { type: 'string', enum: ['consistent', 'contradicted'], description: 'consistent: the belief and every one of the things can be true together; contradicted: at least one thing cannot be true if the belief is.' },
  },
  required: ['reason', 'things', 'verdict'],
  additionalProperties: false,
}

export interface CheckAnswer { reason: string; things: number[]; verdict: 'consistent' | 'contradicted' }

/** Why an answer to the check of one belief cannot be taken, or nothing when it can. */
export function checkProblem(answer: CheckAnswer, belief: CharacterMemory, shown: Shown, near: ReadonlySet<number>, tr: Translate = translator('en')): string | undefined {
  if ((answer.reason ?? '').trim() === '') return tr('say in a sentence what the belief claims and what the things say, before the verdict')
  if (answer.verdict !== 'consistent' && answer.verdict !== 'contradicted') return tr('the verdict is consistent or contradicted')
  const things = answer.things ?? []
  if (answer.verdict === 'consistent') return things.length === 0 ? undefined : tr('a belief that can be true together with all of them names none of them')
  if (things.length === 0) return tr('name the things that cannot be true together with the belief')
  for (const id of things) {
    const entry = shown.perceptions.get(id)
    if (!near.has(id) || entry === undefined) return tr('there is no thing listed numbered {id}', { id })
    if (entry.event.turn < belief.turn) return tr('thing {id} came before the belief was formed', { id })
  }
  return undefined
}

function checkBrief(character: Character, belief: CharacterMemory, things: readonly PerceivedEvent[], now: number, zone: string, time: (turn: number, round: number) => number | undefined, tr: Translate): string {
  return [
    tr('A belief held by {name}: {text}', { name: referent(character), text: belief.text }),
    tr('What they took in since that bears on it:'),
    ...things.map((entry) => { const at = time(entry.event.turn, entry.event.round); return `- p${entry.perception.id}${at === undefined ? '' : ` (${describeWhen(at, now, zone)})`}: ${entry.perception.content}` }),
    tr('Can the belief and each of these be true together? Name the ones that cannot be.'),
  ].join('\n')
}

function brief(session: ReflectionSession, material: Material, doubted: ReadonlySet<number>, now: number, zone: string, time: (turn: number, round: number) => number | undefined, tr: Translate): string {
  const { character, fresh, beliefs } = material
  const named = (id: number): string => session.characters.get(id)?.name ?? String(id)
  const { disputed } = session.memories.evidenceIndex(character.id)
  const believed = beliefs.map((belief) => {
    const about = belief.about.length === 0 ? '' : tr(', about {names}', { names: belief.about.map(named).join(tr(' and ')) })
    const dispute = disputed.has(belief.id) || doubted.has(belief.id) ? tr(', something taken in since speaks against it') : ''
    return `- b${belief.id} (${tr('{kind}, importance {importance}, {confidence}{about}{dispute}', { kind: belief.kind, importance: belief.importance, confidence: tr(belief.confidence), about, dispute })}): ${belief.text}`
  })
  const taken = fresh.map((entry) => {
    const at = time(entry.event.turn, entry.event.round)
    return `- p${entry.perception.id}${at === undefined ? '' : ` (${describeWhen(at, now, zone)})`}: ${entry.perception.content}`
  })
  return [
    tr('Character: {name}{summary}', { name: referent(character), summary: character.summary === '' ? '' : ` - ${character.summary}` }),
    tr('What they believe now:'),
    ...(believed.length === 0 ? [tr('(nothing yet)')] : believed),
    tr('What they have taken in since:'),
    ...taken,
    tr('Sort their memory.'),
  ].join('\n')
}

/**
 * Has the characters with the most new to sort sort it into what they believe, one request each, one after another. Each answer is checked
 * against what the character was shown before it is written, and the writing of one character is all or nothing; a failure stops the pass
 * and leaves the characters not yet done as they were.
 */
export function memoryReflector(deps: { agentOf: (chat: string) => Agent | undefined; decisions?: () => DecisionService | undefined; problem?: (message: string) => void }): Reflector {
  const seen = new Map<string, string>()
  return {
    async reflect(job, signal) {
      const parent = deps.agentOf(job.chat)
      if (parent === undefined) throw new Error(`no agent for chat ${job.chat}`)
      const { store } = job
      const session: ReflectionSession = store.story
      const settings = store.settings()
      const { now, zone } = store.time(job.turn)
      const due = materialOf(session, job.reason === 'manual' ? 1 : settings.reflection.minNew)
      const taken = job.reason === 'manual' ? due : due.slice(0, settings.reflection.perRun)
      const resolveName = (name: string): string | undefined => {
        const found = session.characters.findByName(name.trim())
        return found.length === 1 ? characterKey(found[0]!) : undefined
      }
      const tr = translator(languageOf(settings.prompts.language))
      const characters: ReflectionOutcome[] = []
      const failures: string[] = []
      const sort = async (material: Material): Promise<ReflectionOutcome> => {
        const shown = shownOf(session, material)
        const found: Contradiction[] = []
        let checked = 0
        const reports: SiteReport[] = []
        for (const belief of material.beliefs) {
          const near = bearingOn(belief, material.fresh)
          if (near.length === 0 || checked >= MAX_CHECKS) continue
          checked += 1
          const askLanguageModel = async (ids: readonly number[]): Promise<Map<number, boolean>> => {
            const things = ids.flatMap(id => shown.perceptions.get(id) ?? [])
            let verdict: CheckAnswer | undefined
            try {
              verdict = await runChild<CheckAnswer>({
                parent, signal, reasoningEffort: settings.reasoning.children, sampling: childSampling(settings, 'records', estimateAnswer([MAX_TEXT * 2, 100], settings.prompts.language)), ...childModel(settings, 'records'), trace: childTrace(store, 'records', `reflection check ${material.character.name} b${belief.id}`),
                persona: promptFor(parent, 'roleplay/reflection-check', settings.prompts.language),
                prompt: checkBrief(material.character, belief, things, now, zone, (turn, round) => session.clock.at(turn, round), tr),
                result: CHECK_RESULT,
                beforeSubmit: (value) => { const problem = checkProblem(value as CheckAnswer, belief, shown, new Set(ids), tr); return problem === undefined ? undefined : tr('not acceptable: {problems}', { problems: problem }) },
                maxCalls: 2,
              })
            } catch (error) {
              if (signal.aborted) throw error
            }
            const named = new Set(verdict?.verdict === 'contradicted' ? verdict.things : [])
            return new Map(ids.map(id => [id, named.has(id)]))
          }
          // A thing that came before the belief was formed cannot contradict it, so the decision model is not asked about it.
          const askDecisionModel = async (ids: readonly number[]): Promise<Map<number, number>> => {
            const service = deps.decisions?.()
            if (service === undefined) throw new Error('no decision service is selected, or the selected one is not loaded')
            const askable = ids.filter(id => (shown.perceptions.get(id)?.event.turn ?? -1) >= belief.turn)
            const answers = askable.length === 0 ? new Map<string, number>() : await askYesNo(service,
              { held_by: referent(material.character), belief: belief.text, things: Object.fromEntries(askable.map(id => [`p${id}`, shown.perceptions.get(id)!.perception.content])) },
              askable.map(id => ({ key: `p${id}`, instructions: store.text('roleplay/decide-reflection', { thing: `p${id}` }) })), signal)
            return new Map(ids.map(id => [id, answers.get(`p${id}`) ?? 0]))
          }
          const routed = await routeVerdicts<number>({
            mode: settings.decisions.reflection, yesAt: yesAt(settings.decisions.confidence), noAt: noAt(settings.decisions.confidence), turn: job.turn, keys: near,
            what: id => `${belief.text} / ${shown.perceptions.get(id)?.perception.content ?? ''}`,
            probabilities: askDecisionModel, llm: askLanguageModel,
          }, signal)
          reports.push(routed.report)
          const contradicted = [...routed.verdicts].filter(([, yes]) => yes).map(([id]) => id)
          if (contradicted.length > 0) found.push({ belief: belief.id, things: contradicted })
        }
        if (reports.length > 0) {
          const merged = mergeReports(settings.decisions.reflection, reports)
          announceProblem(seen, `${job.chat}:reflection`, merged, deps.problem)
          store.recordDecisions?.('reflection', merged)
        }
        const doubted = new Set(found.map(entry => entry.belief))
        const answered = await runChild<Proposal>({
          parent, signal, reasoningEffort: settings.reasoning.children, sampling: childSampling(settings, 'records', estimateAnswer(Array.from({ length: MAX_ADDED + MAX_CHANGES }, () => MAX_TEXT), settings.prompts.language)), ...childModel(settings, 'records'), trace: childTrace(store, 'records', `reflection ${material.character.name}`),
          persona: promptFor(parent, 'roleplay/reflection', settings.prompts.language),
          prompt: brief(session, material, doubted, now, zone, (turn, round) => session.clock.at(turn, round), tr),
          result: RESULT,
          beforeSubmit: (value) => {
            const given = settleProposal(value as Proposal, shown, resolveName)
            const problems = [...proposalProblems(given, shown, resolveName, tr), ...[wrongLanguage(settings.prompts.language, { beliefs: [...(given.add ?? []), ...(given.revise ?? []), ...(given.doubt ?? [])].map(belief => belief.text ?? '').join(' ') })].flatMap(problem => (problem === undefined ? [] : [problem]))]
            return problems.length === 0 ? undefined : tr('not acceptable: {problems}', { problems: problems.join('; ') })
          },
          maxCalls: 3,
        })
        const proposal = withDoubts(settleProposal(answered, shown, resolveName), found)
        const reached = Math.max(...material.fresh.map(entry => entry.perception.id))
        session.transaction(() => {
          session.edit(editOf(job.turn, material.character, proposal, resolveName, belief => shown.beliefs.get(belief)?.confidence))
          session.metadata.setValue(CURSOR_KEY, { ...readCursor(session), [characterKey(material.character)]: reached })
        })
        return { name: material.character.name, added: proposal.add?.length ?? 0, revised: (proposal.revise?.length ?? 0) + (proposal.doubt?.length ?? 0), dropped: proposal.drop?.length ?? 0 }
      }
      // A model that runs on over a long list does not over a shorter one: the older half is sorted now, and the rest follows in the next pass.
      const sortWithRetry = async (material: Material): Promise<ReflectionOutcome> => {
        try { return await sort(material) } catch (error) {
          if (signal.aborted || material.fresh.length < MIN_TO_HALVE) throw error
          return await sort({ ...material, fresh: material.fresh.slice(0, Math.ceil(material.fresh.length / 2)) })
        }
      }
      for (const material of taken) {
        try { characters.push(await sortWithRetry(material)) } catch (error) {
          if (signal.aborted) throw error
          failures.push(`${material.character.name}: ${error instanceof Error ? error.message : String(error)}`)
        }
      }
      if (failures.length > 0 && characters.length === 0) throw new Error(failures.join('; '))
      session.metadata.setValue(LAST_KEY, { turn: job.turn, at: new Date().toISOString(), reason: job.reason, characters } satisfies Last)
      writeAnchor(session, playerPlace(store), now)
      if (failures.length > 0) recordFailure(session, tr('{names} could not be sorted this time and will be tried again: {reason}', { names: failures.map(entry => entry.split(':')[0]).join(', '), reason: failures[0]!.slice(failures[0]!.indexOf(':') + 2) }))
      else session.metadata.deleteValue(ERROR_KEY)
      return { characters }
    },
  }
}
