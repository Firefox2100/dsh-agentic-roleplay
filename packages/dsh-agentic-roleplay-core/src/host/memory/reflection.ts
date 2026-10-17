import type { Agent } from '@deepseek-ai/dsh-agent'
import type { ObjectJsonSchema } from '@deepseek-ai/dsh-tools'
import { characterKey, type RecordsEdit, type Session } from '@dsh-agentic-roleplay/state'
import { IMPORTANCE_MAX, IMPORTANCE_MIN, MEMORY_CONFIDENCES, MEMORY_KINDS, languageOf, translator, type Character, type CharacterMemory, type Location, type MemoryConfidence, type MemoryKind, type PerceivedEvent, type Translate } from 'dsh-roleplay-model'
import type { ReflectionOutcome, ReflectionReason, ReflectionStatus } from '../../shared/reflection.ts'
import { wrongLanguage } from '../translate/language.ts'
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

/** What a model writes into a belief's text when it has not put it in the fields: its confidence, importance or the numbers it rests on. */
const MIXED_IN = /\((?:[^)]*\b(?:doubtful|likely|sure|importance)\b[^)]*|[^)]*\bperceptions?\s*\[?\d[^)]*)\)|\bperceptions?\s*\[\d/i

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
    if (change.text !== undefined && (change.text.trim() === '' || change.text.trim().length > MAX_TEXT)) problems.push(tr('{where}: the text must be there and at most {max} characters; leave it out to keep the belief as it is', { where, max: MAX_TEXT }))
    if (change.text !== undefined && MIXED_IN.test(change.text)) problems.push(tr('{where}: the confidence, the importance and the numbers are fields of their own, not part of the text', { where }))
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
    if (change.text !== undefined && MIXED_IN.test(change.text)) problems.push(tr('{where}: the confidence, the importance and the numbers are fields of their own, not part of the text', { where }))
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

function brief(session: ReflectionSession, material: Material, now: number, zone: string, time: (turn: number, round: number) => number | undefined, tr: Translate): string {
  const { character, fresh, beliefs } = material
  const named = (id: number): string => session.characters.get(id)?.name ?? String(id)
  const { disputed } = session.memories.evidenceIndex(character.id)
  const believed = beliefs.map((belief) => {
    const about = belief.about.length === 0 ? '' : tr(', about {names}', { names: belief.about.map(named).join(tr(' and ')) })
    const dispute = disputed.has(belief.id) ? tr(', something taken in since speaks against it') : ''
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
export function memoryReflector(deps: { agentOf: (chat: string) => Agent | undefined }): Reflector {
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
      for (const material of taken) {
        const shown = shownOf(session, material)
        const proposal = await runChild<Proposal>({
          parent, signal, reasoningEffort: settings.reasoning.children, sampling: childSampling(settings, 'records'), ...childModel(settings, 'records'), trace: childTrace(store, 'records', `reflection ${material.character.name}`),
          persona: promptFor(parent, 'roleplay/reflection', settings.prompts.language),
          prompt: brief(session, material, now, zone, (turn, round) => session.clock.at(turn, round), tr),
          result: RESULT,
          beforeSubmit: (value) => {
            const given = value as Proposal
            const problems = [...proposalProblems(given, shown, resolveName, tr), ...[wrongLanguage(settings.prompts.language, { beliefs: [...(given.add ?? []), ...(given.revise ?? []), ...(given.doubt ?? [])].map(belief => belief.text ?? '').join(' ') })].flatMap(problem => (problem === undefined ? [] : [problem]))]
            return problems.length === 0 ? undefined : tr('not acceptable: {problems}', { problems: problems.join('; ') })
          },
          maxCalls: 3,
        })
        const reached = Math.max(...material.fresh.map(entry => entry.perception.id))
        session.transaction(() => {
          session.edit(editOf(job.turn, material.character, proposal, resolveName, belief => shown.beliefs.get(belief)?.confidence))
          session.metadata.setValue(CURSOR_KEY, { ...readCursor(session), [characterKey(material.character)]: reached })
        })
        characters.push({ name: material.character.name, added: proposal.add?.length ?? 0, revised: (proposal.revise?.length ?? 0) + (proposal.doubt?.length ?? 0), dropped: proposal.drop?.length ?? 0 })
      }
      session.metadata.setValue(LAST_KEY, { turn: job.turn, at: new Date().toISOString(), reason: job.reason, characters } satisfies Last)
      writeAnchor(session, playerPlace(store), now)
      session.metadata.deleteValue(ERROR_KEY)
      return { characters }
    },
  }
}
