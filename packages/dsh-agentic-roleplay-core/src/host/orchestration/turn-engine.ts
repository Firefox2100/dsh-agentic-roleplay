import { locationKey as placeKey, type Recalled } from 'dsh-roleplay-state'
import { AUTHORING_NEEDS, type Boundaries, type CastMember, type CharacterRequest, type CreateReport, type KnownRelationship, type Reaction, type TurnStore } from './boundaries.ts'
import { RESULTS, type CharacterAction, type CharacterFailure, type CharacterReport, type NarrationSegment, type Outcome, type TurnOutput, type Utterance } from './protocol.ts'

/** Asks one character to act; what the game master calls a character is the character's key. */
export type RunCharacter = (request: CharacterRequest, signal: AbortSignal) => Promise<CharacterAction>

export interface TurnOwner {
  /** The chat the turn belongs to. */
  chat: string
  turn: number
}

/** What the characters answered when they were asked, once or on the retry. */
export interface AttemptReport {
  attempt: 1 | 2
  reports: CharacterReport[]
  failures: CharacterFailure[]
}

export interface ResolveReport {
  /** Present while a retry still has to be resolved. */
  next?: AttemptReport
  /** Present once the round is recorded. */
  done?: {
    /** The number of this round within the turn. */
    round: number
    /** The most rounds this chat allows for one player message. */
    limit: number
    updated: string[]
    retryFailures: CharacterFailure[]
    /** What was said in this round. */
    utterances: Utterance[]
    /** What was said in the whole turn so far; the output must carry all of it, in this order. */
    spoken: Utterance[]
    /** How many recorded rounds, this one included, are waiting for their memory to be written. */
    waiting: number
    /** Who went where in this round. */
    moves: { character: string; name: string; to: string; via: number }[]
  }
}

/** One part of the output as the game master delivers it, before it is checked. */
export interface RawSegment {
  type: 'utterance' | 'narration'
  character?: string
  text: string
}

/** Between rounds the game master chooses: another round of characters, or the output. */
type Phase = 'idle' | 'resolving' | 'retrying' | 'between' | 'done' | 'skipped'

interface Attempt {
  reports: CharacterReport[]
  failures: CharacterFailure[]
  outcomes?: Outcome[]
}

interface TurnState {
  turn: number
  phase: Phase
  cast: CastMember[]
  /** The rounds recorded so far. */
  rounds: number
  situations: string[]
  /** What the current round is about. */
  situation: string
  first?: Attempt
  second?: Attempt
  /** What happened in the rounds recorded so far, for the characters of the next one. */
  history: Reaction[]
  /** The final report and outcome of every character in every recorded round. */
  reports: CharacterReport[]
  outcomes: Outcome[]
  utterances: Utterance[]
  /** How many times the game master delivered an output that was refused. */
  refused: number
  /** The most rounds the chat's settings allowed when last asked. */
  limit?: number
  /** Writing the records of the rounds: one run at a time, while the game master goes on. */
  writing: Promise<void>
  /** What the game master said is worth keeping, when it asked for the records to be written. */
  focus: string[]
  /** Whether the game master asked for the records to be written in this turn. */
  requested: boolean
  cancel: AbortController
  /** What each character was reminded of in the first attempt of the round, so a retry is reminded of the same. */
  recalled: Map<string, readonly Recalled[]>
}

const MAX_OBJECTIONS = 3
/** Something made up that has waited this many turns is fitted into the world even if few are waiting. */
const STALE_AFTER_TURNS = 4
/** The game master is asked to correct its output this many times before it is corrected for it. */
const MAX_REFUSALS = 2

/**
 * The loop of one turn: rounds of characters acting, each resolved by the game master
 * (a committed character whose intent failed acts once more within its round), until
 * the output of the turn is delivered. The number of rounds is bounded by the chat's
 * settings. It knows nothing of DSH; characters and storage come in from outside.
 */
export class TurnEngine {
  private readonly states = new Map<string, TurnState>()
  private readonly objections = new Map<string, number>()
  /** Chats whose made-up characters and places are being fitted into the world now: one run at a time. */
  private readonly consolidating = new Set<string>()

  constructor(
    private readonly boundaries: () => Boundaries,
    private readonly stores: (chat: string) => TurnStore | undefined,
    /** Told about a run of the records that failed; the rounds stay queued and the next run writes them with its own. */
    private readonly problem: (message: string) => void = () => undefined,
    /** Told when the records of a chat were written, so that what is new in them can be indexed. */
    private readonly written: (chat: string) => void = () => undefined,
  ) {}

  /** Mark a turn as one that needs no round, for example because the player's input was refused. */
  skip(owner: TurnOwner): void {
    this.stateFor(owner).phase = 'skipped'
  }

  /**
   * Ask the characters to act: the first round of a turn, or the next one.
   * @throws {Error} when a round is still open, the limit of rounds is reached, a character cannot be activated or no store exists.
   */
  async activate(owner: TurnOwner, input: { situation: string; characters?: readonly string[] }, run: RunCharacter, signal: AbortSignal): Promise<AttemptReport> {
    const state = this.stateFor(owner)
    if (state.phase !== 'idle' && state.phase !== 'between') throw new Error(this.explain(state, 'activate_characters'))
    const store = this.storeOf(owner)
    const limit = store.settings().maxRounds
    if (state.rounds >= limit) {
      throw new Error(`${state.rounds} round${state.rounds === 1 ? '' : 's'} of characters were already played for this message, which is the most this chat allows: deliver the output with narrate`)
    }
    const situation = input.situation.trim()
    if (situation === '') throw new Error('describe the situation: the characters are told nothing else')
    const cast = store.cast()
    const keys = this.boundaries().planner.plan({ cast, ...(input.characters === undefined ? {} : { requested: input.characters }) })
    if (keys.length === 0) throw new Error('there is no character to activate')
    state.situation = situation
    state.cast = cast
    state.recalled.clear()
    delete state.first
    delete state.second
    const attempt = await this.runAttempt(owner, 1, keys, cast, state, run, signal)
    if (attempt.reports.length === 0) return { attempt: 1, reports: [], failures: attempt.failures }
    state.first = attempt
    state.phase = 'resolving'
    return { attempt: 1, reports: attempt.reports, failures: attempt.failures }
  }

  /**
   * Record the game master's decisions. After the first attempt of a round this may start
   * the retry; after the retry, or when nobody retries, it records the round.
   * @throws {Error} when the outcomes do not cover exactly the characters waiting for one.
   */
  async resolve(owner: TurnOwner, outcomes: readonly Outcome[], run: RunCharacter, signal: AbortSignal): Promise<ResolveReport> {
    const state = this.stateFor(owner)
    if (state.phase !== 'resolving' && state.phase !== 'retrying') throw new Error(this.explain(state, 'resolve_round'))
    const attempt = state.phase === 'resolving' ? state.first : state.second
    if (attempt === undefined) throw new Error('internal: no round to resolve')
    this.check(attempt, outcomes, this.storeOf(owner))
    attempt.outcomes = [...outcomes]

    if (state.phase === 'resolving') {
      const retrying = this.boundaries().retryPolicy.select({ reports: attempt.reports, outcomes: attempt.outcomes })
        .filter(key => attempt.reports.some(report => report.character === key))
      if (retrying.length > 0) {
        const second = await this.runAttempt(owner, 2, retrying, state.cast, state, run, signal)
        state.second = second
        if (second.reports.length > 0) {
          state.phase = 'retrying'
          return { next: { attempt: 2, reports: second.reports, failures: second.failures } }
        }
      }
    }
    return { done: this.finishRound(owner, state) }
  }

  /**
   * Take the output of the turn from the game master. An output that changes, drops, invents
   * or reorders an utterance is refused with what is wrong, so that the game master can
   * correct it; after it was refused a few times it is corrected here instead. Without
   * segments, the narrator boundary is asked to write it.
   * @throws {Error} naming every problem, while the game master may still correct it.
   */
  async narrate(owner: TurnOwner, segments: readonly RawSegment[]): Promise<TurnOutput> {
    const state = this.stateFor(owner)
    if (state.phase !== 'between') throw new Error(this.explain(state, 'narrate'))
    if (segments.length === 0) {
      const written = await this.boundaries().narrator.narrate({ situations: state.situations, outcomes: state.outcomes, reports: state.reports, utterances: state.utterances })
      if (written === undefined) throw new Error('deliver the output: give its segments')
      return await this.deliver(owner, state, written, true)
    }
    const typed = segments.map((segment): NarrationSegment => segment.type === 'utterance'
      ? { type: 'utterance', character: segment.character ?? '', name: state.cast.find(member => member.key === segment.character)?.character.name ?? segment.character ?? '', text: segment.text }
      : { type: 'narration', text: segment.text })
    return await this.deliver(owner, state, typed, false)
  }

  /**
   * The game master asks for something to be made up (a place the story has gone to, someone who has
   * joined): the world author decides whether the story genuinely needs it, and makes it or says why not.
   * The world may be closed, and only so many things may be made up in a turn.
   * @throws {Error} when the world is closed, the limit of the turn is reached, a round is open, or the request is empty.
   */
  async expand(owner: TurnOwner, input: { need: string; what: string }, signal: AbortSignal): Promise<CreateReport> {
    const state = this.stateFor(owner)
    if (state.phase === 'resolving' || state.phase === 'retrying') throw new Error('resolve the round first: the world is extended between rounds, not in the middle of one')
    const need = AUTHORING_NEEDS.find(candidate => candidate === input.need)
    if (need === undefined) throw new Error(`"${input.need}" is not a reason to make something up; the reasons are: ${AUTHORING_NEEDS.join(', ')}`)
    const what = input.what.trim()
    if (what === '') throw new Error('say what is needed, from what the story has established: who or where, and why now')
    const store = this.storeOf(owner)
    const { authoring } = store.settings()
    if (!authoring.enabled) throw new Error('this world is closed: nothing can be made up in it')
    const made = store.story.consolidation.createdIn(owner.turn).length
    if (made >= authoring.perTurn) throw new Error(`${made} new thing${made === 1 ? ' was' : 's were'} already made up this turn, which is the most this chat allows: work with what exists`)
    return await this.boundaries().author.create({ chat: owner.chat, turn: owner.turn, need, what, store }, signal)
  }

  /** Whether made-up characters and places are waiting to be fitted into the world. */
  waitingToFit(owner: TurnOwner): number {
    return this.stores(owner.chat)?.story.consolidation.pending().length ?? 0
  }

  /**
   * Fit what was made up into the rest of the world in the background, when enough of it is waiting or some
   * has waited long: the turn does not wait for it, and a failed run leaves everything queued for the next.
   */
  private consolidateIfDue(owner: TurnOwner, state: TurnState): void {
    const store = this.stores(owner.chat)
    if (store === undefined || this.consolidating.has(owner.chat)) return
    const { authoring } = store.settings()
    const pending = store.story.consolidation.pending()
    if (!authoring.enabled || pending.length === 0) return
    if (pending.length < authoring.consolidateAfter && !pending.some(item => owner.turn - item.createdTurn >= STALE_AFTER_TURNS)) return
    this.consolidating.add(owner.chat)
    void this.boundaries().author.consolidate({ chat: owner.chat, turn: owner.turn, store }, state.cancel.signal)
      .then(() => { this.written(owner.chat) })
      .catch((error: unknown) => {
        if (!state.cancel.signal.aborted) this.problem(`made-up characters and places were not fitted into the world: ${error instanceof Error ? error.message : String(error)}`)
      })
      .finally(() => { this.consolidating.delete(owner.chat) })
  }

  /** What still has to happen before the turn may end, or nothing when it may. */
  missing(owner: TurnOwner): string | undefined {
    const state = this.stateFor(owner)
    if (state.phase === 'done' || state.phase === 'skipped') return undefined
    return this.explain(state, undefined)
  }

  /** Wait until the records of the rounds recorded so far are written or have failed. */
  async flush(owner: TurnOwner): Promise<void> {
    await this.stateFor(owner).writing
  }

  /** What has been said in the turn so far. */
  spoken(owner: TurnOwner): readonly Utterance[] {
    return this.stateFor(owner).utterances
  }

  /** Whether the game master may still be turned back, counting this objection. */
  object(owner: TurnOwner): boolean {
    const key = `${owner.chat}#${owner.turn}`
    const count = (this.objections.get(key) ?? 0) + 1
    this.objections.set(key, count)
    return count <= MAX_OBJECTIONS
  }

  forget(chat: string): void {
    this.states.get(chat)?.cancel.abort()
    this.states.delete(chat)
    for (const key of this.objections.keys()) if (key.startsWith(`${chat}#`)) this.objections.delete(key)
  }

  private stateFor({ chat, turn }: TurnOwner): TurnState {
    const known = this.states.get(chat)
    if (known?.turn === turn) return known
    const fresh: TurnState = { turn, phase: 'idle', cast: [], rounds: 0, situations: [], situation: '', history: [], reports: [], outcomes: [], utterances: [], refused: 0, writing: Promise.resolve(), focus: [], requested: false, cancel: new AbortController(), recalled: new Map() }
    this.states.set(chat, fresh)
    return fresh
  }

  private storeOf(owner: TurnOwner): TurnStore {
    const store = this.stores(owner.chat)
    if (store === undefined) throw new Error('this chat is not a roleplay session')
    return store
  }

  private explain(state: TurnState, attempted: 'activate_characters' | 'resolve_round' | 'narrate' | undefined): string {
    const waiting = (attempt: Attempt | undefined): string => (attempt?.reports ?? []).map(report => report.character).join(', ')
    switch (state.phase) {
      case 'idle': return attempted === 'activate_characters' || attempted === undefined
        ? 'call activate_characters to let the characters act'
        : `nothing to ${attempted === 'narrate' ? 'deliver' : 'resolve'} yet: call activate_characters first`
      case 'resolving': return attempted === 'activate_characters'
        ? 'the characters already acted in this round: call resolve_round'
        : attempted === 'narrate'
          ? `resolve the round first: call resolve_round with one outcome for each of: ${waiting(state.first)}`
          : `call resolve_round with one outcome for each of: ${waiting(state.first)}`
      case 'retrying': return attempted === 'activate_characters'
        ? 'the characters already acted in this round: call resolve_round'
        : attempted === 'narrate'
          ? `resolve the round first: call resolve_round once more, with one outcome for each of: ${waiting(state.second)}`
          : `call resolve_round once more, with one outcome for each of: ${waiting(state.second)}`
      case 'between': return attempted === 'resolve_round'
        ? 'the round is already recorded: call activate_characters again if the story needs it, or narrate'
        : `call narrate with the output of the turn${this.mustSay(state)}${this.canContinue(state)}`
      case 'done': return 'this turn is already recorded'
      case 'skipped': return 'this turn needs no round'
    }
  }

  private canContinue(state: TurnState): string {
    const left = (state.limit ?? 0) - state.rounds
    return left > 0 ? `, or call activate_characters if the story genuinely needs them again (${left} round(s) left)` : ''
  }

  private mustSay(state: TurnState): string {
    return state.utterances.length === 0
      ? ''
      : `; it must carry these utterances exactly, in this order: ${state.utterances.map(utterance => `${utterance.name}: "${utterance.text}"`).join(' | ')}`
  }

  private check(attempt: Attempt, outcomes: readonly Outcome[], store: TurnStore): void {
    const expected = attempt.reports.map(report => report.character)
    const given = outcomes.map(outcome => outcome.character)
    const problems = [
      ...expected.filter(key => !given.includes(key)).map(key => `missing an outcome for ${key}`),
      ...[...new Set(given.filter(key => !expected.includes(key)))].map(key => `${key} is not waiting for an outcome`),
      ...[...new Set(given.filter((key, index) => given.indexOf(key) !== index))].map(key => `more than one outcome for ${key}`),
      ...outcomes.filter(outcome => !RESULTS.includes(outcome.result)).map(outcome => `${outcome.character}: unknown result "${outcome.result}"`),
      ...outcomes.filter(outcome => outcome.summary.trim() === '').map(outcome => `${outcome.character}: say what happens`),
      ...outcomes.flatMap(outcome => this.moveProblems(outcome, store)),
    ]
    if (problems.length > 0) throw new Error(`the outcomes are not acceptable: ${problems.join('; ')} (expected exactly: ${expected.join(', ')})`)
  }

  /** Why a character cannot go where the outcome sends it, if it cannot: the game master hears it before the round is recorded. */
  private moveProblems(outcome: Outcome, store: TurnStore): string[] {
    if (outcome.moveTo === undefined) return []
    if (outcome.result === 'failed') return [`${outcome.character}: its intent failed, so it does not go anywhere: leave moves_to out`]
    const checked = store.checkMove(outcome.character, outcome.moveTo)
    return checked.ok ? [] : checked.problems.map(problem => `${outcome.character}: cannot go to ${outcome.moveTo?.location}: ${problem}`)
  }

  /** Every character acts at the same time; one that fails or answers badly is reported, not fatal. */
  private async runAttempt(owner: TurnOwner, number: 1 | 2, keys: readonly string[], cast: readonly CastMember[], state: TurnState, run: RunCharacter, signal: AbortSignal): Promise<Attempt> {
    const store = this.stores(owner.chat)
    const { outputValidator } = this.boundaries()
    const reaction = number === 2 ? this.reactions(state) : undefined
    // One vector of the moment serves every character; the search of what each remembers is its own.
    const queryVector = number === 1 && store !== undefined ? await store.queryVector(state.situation, signal) : undefined
    const answers = await Promise.all(keys.map(async (key): Promise<CharacterReport | CharacterFailure> => {
      const member = cast.find(candidate => candidate.key === key)
      if (member === undefined) return { character: key, name: key, reason: 'no such character' }
      const previous = number === 2 ? state.first?.reports.find(report => report.character === key) : undefined
      const memories = number === 1 && store !== undefined
        ? await this.boundaries().recaller.recall({ member, situation: state.situation, turn: owner.turn, policy: store.settings().memory, ...(queryVector === undefined ? {} : { queryVector }) }, store.story, signal)
        : state.recalled.get(key) ?? []
      if (number === 1 && memories.length > 0) state.recalled.set(key, memories)
      const place = member.place === undefined ? undefined : store?.place(member.place.location.id)
      const relationships = store === undefined ? [] : this.knownRelationships(member, place === undefined ? cast : place.here, store)
      const request: CharacterRequest = {
        member, cast, situation: state.situation, attempt: number, turn: owner.turn, lookup: store?.settings().memory.lookup ?? false,
        ...(place === undefined ? {} : { place }),
        ...(relationships.length === 0 ? {} : { relationships }),
        ...(memories.length === 0 ? {} : { memories }),
        ...(state.history.length === 0 ? {} : { earlier: [...state.history] }),
        ...(reaction === undefined ? {} : { reaction }),
        ...(previous === undefined ? {} : { previous: { intent: previous.intent, commitment: previous.commitment } }),
      }
      try {
        const action = await run(request, signal)
        const verdict = outputValidator.validate(action, request)
        if (!verdict.ok) return { character: key, name: member.character.name, reason: verdict.reason }
        return { character: key, name: member.character.name, ...action }
      } catch (error) {
        if (signal.aborted) throw error
        return { character: key, name: member.character.name, reason: error instanceof Error ? error.message : String(error) }
      }
    }))
    return {
      reports: answers.filter((answer): answer is CharacterReport => 'intent' in answer),
      failures: answers.filter((answer): answer is CharacterFailure => 'reason' in answer),
    }
  }

  /** How a character sees those it is with, for those it has a profile of. */
  private knownRelationships(member: CastMember, company: readonly CastMember[], store: TurnStore): KnownRelationship[] {
    return store.story.relationships.from(member.character.id).flatMap((relation) => {
      const other = company.find(candidate => candidate.character.id === relation.toId)
      return other === undefined || other.key === member.key ? [] : [{ name: other.character.name, label: relation.label, summary: relation.summary, familiarity: relation.familiarity, trust: relation.trust, affinity: relation.affinity, tension: relation.tension }]
    })
  }

  private reactions(state: TurnState): Reaction[] {
    const first = state.first
    return (first?.outcomes ?? []).flatMap((outcome) => {
      const report = first?.reports.find(candidate => candidate.character === outcome.character)
      return report === undefined ? [] : [{ character: report.character, name: report.name, intent: report.intent, ...(report.utterance === undefined ? {} : { utterance: report.utterance }), result: outcome.result, summary: outcome.summary }]
    })
  }

  /** The final decision for each character of the round: the retry's replaces the first attempt's. */
  private decisions(state: TurnState): Map<string, { outcome: Outcome; report: CharacterReport }> {
    const decided = new Map<string, { outcome: Outcome; report: CharacterReport }>()
    for (const attempt of [state.first, state.second]) {
      for (const outcome of attempt?.outcomes ?? []) {
        const report = attempt?.reports.find(candidate => candidate.character === outcome.character)
        if (report !== undefined) decided.set(outcome.character, { outcome, report })
      }
    }
    return decided
  }

  private finishRound(owner: TurnOwner, state: TurnState): NonNullable<ResolveReport['done']> {
    const store = this.storeOf(owner)
    const decided = this.decisions(state)
    const limit = store.settings().maxRounds
    const round = state.rounds + 1
    const checked = new Map([...decided.values()].flatMap(({ outcome }) => (outcome.moveTo === undefined ? [] : [[outcome.character, store.checkMove(outcome.character, outcome.moveTo)] as const])))
    const refused = [...checked].flatMap(([character, check]) => (check.ok ? [] : [`${character}: ${check.problems.join('; ')}`]))
    if (refused.length > 0) throw new Error(`a move is no longer possible: ${refused.join('; ')}`)
    const spoken = [...decided.values()].flatMap(({ outcome, report }): Utterance[] =>
      report.utterance === undefined || outcome.spoken === false ? [] : [{ character: report.character, name: report.name, text: report.utterance, round }])
    state.rounds = round
    state.situations.push(state.situation)
    state.utterances.push(...spoken)
    for (const { outcome, report } of decided.values()) {
      state.reports.push(report)
      state.outcomes.push(outcome)
      state.history.push({
        round, character: report.character, name: report.name, intent: report.intent,
        ...(report.utterance === undefined ? {} : { utterance: report.utterance }), result: outcome.result, summary: outcome.summary,
      })
    }
    state.limit = limit
    state.phase = 'between'
    const playerPlace = state.cast.find(member => member.character.control === 'player')?.place?.location
    // What the game master decided about each character is applied at once, moves included; the memory of what happened is written when it is asked for.
    store.commit([...decided.values()].flatMap(({ outcome, report }) => {
      const member = state.cast.find(candidate => candidate.key === report.character)
      if (member === undefined) return []
      const check = checked.get(outcome.character)
      return [{
        character: member.character.id,
        patch: { activity: outcome.summary, ...(outcome.publicState === undefined || outcome.publicState.trim() === '' ? {} : { publicState: outcome.publicState.trim() }) },
        ...(check?.ok === true ? { move: check.move } : {}),
      }]
    }))
    store.queueCommit({
      turn: owner.turn, round, situation: state.situation,
      ...(playerPlace === undefined ? {} : { place: { key: placeKey(playerPlace), name: playerPlace.name } }),
      entries: [...decided.values()].map(({ outcome, report }) => {
        const at = state.cast.find(candidate => candidate.key === report.character)?.place?.location
        const check = checked.get(outcome.character)
        return {
          character: report.character, name: report.name, intent: report.intent, commitment: report.commitment,
          ...(report.utterance === undefined ? {} : { utterance: report.utterance }),
          result: outcome.result, summary: outcome.summary,
          ...(outcome.publicState === undefined || outcome.publicState.trim() === '' ? {} : { publicState: outcome.publicState.trim() }),
          spoken: outcome.spoken !== false,
          ...(at === undefined ? {} : { at: { key: placeKey(at), name: at.name } }),
          ...(check?.ok === true && check.plan.from !== check.move.to ? { moved: { ...check.to, ...(check.position === undefined ? {} : { position: check.position }) } } : {}),
        }
      }),
    })
    return { round, limit, updated: [...decided.keys()], retryFailures: state.second?.failures ?? [], utterances: spoken, spoken: [...state.utterances], waiting: store.pendingCommits().length, moves: [...checked].flatMap(([character, check]) => (check.ok && check.plan.from !== check.move.to ? [{ character, name: decided.get(character)?.report.name ?? character, to: check.to.name, via: Math.max(0, check.plan.via.length - 1) }] : [])) }
  }

  /**
   * The game master asks for what happened to be written into the story's lasting records. The memory
   * keeper runs in the background and writes every round still waiting, not only the latest.
   * @throws {Error} when no recorded round is waiting.
   */
  record(owner: TurnOwner, focus?: string): number {
    const state = this.stateFor(owner)
    const waiting = this.storeOf(owner).pendingCommits().length
    if (waiting === 0) throw new Error('nothing is waiting to be recorded: the rounds so far are already in the story\'s records')
    if (focus !== undefined && focus.trim() !== '') state.focus.push(focus.trim())
    state.requested = true
    this.write(owner, state)
    return waiting
  }

  /** How many recorded rounds wait for their memory to be written. */
  waiting(owner: TurnOwner): number {
    return this.stores(owner.chat)?.pendingCommits().length ?? 0
  }

  /**
   * Write the records of every round still waiting, while the game master goes on. Runs
   * follow one another, and a failed run leaves its rounds queued for the next one.
   */
  private write(owner: TurnOwner, state: TurnState): void {
    state.writing = state.writing.then(async () => {
      const store = this.stores(owner.chat)
      const rounds = store?.pendingCommits() ?? []
      if (store === undefined || rounds.length === 0) return
      try {
        await this.boundaries().committer.commit({ chat: owner.chat, rounds, store, ...(state.focus.length === 0 ? {} : { focus: [...state.focus] }) }, state.cancel.signal)
        store.completeCommits(rounds)
        state.focus = []
        this.written(owner.chat)
      } catch (error) {
        if (!state.cancel.signal.aborted) this.problem(`the records of ${rounds.map(round => `${round.turn}.${round.round}`).join(', ')} were not written: ${error instanceof Error ? error.message : String(error)}`)
      }
    })
  }

  /**
   * Before the turn ends: wait for a run in flight, and run again when the records are due, because
   * the game master asked and a run failed, or because too many rounds are waiting for it to ask.
   */
  private async settle(owner: TurnOwner, state: TurnState): Promise<void> {
    await state.writing
    const store = this.stores(owner.chat)
    const waiting = store?.pendingCommits().length ?? 0
    if (store !== undefined && waiting > 0 && (state.requested || waiting >= store.settings().memory.backlogRounds)) {
      this.write(owner, state)
      await state.writing
    }
  }

  private async deliver(owner: TurnOwner, state: TurnState, segments: readonly NarrationSegment[], silent: boolean): Promise<TurnOutput> {
    const { narrationChecker } = this.boundaries()
    const problems = [
      ...segments.flatMap((segment, index) => (segment.type === 'utterance' && segment.character === '' ? [`segment ${index + 1}: an utterance needs the character who says it`] : [])),
      ...narrationChecker.check(segments, state.utterances),
    ]
    let output: TurnOutput
    if (problems.length === 0) {
      output = { segments: [...segments], repaired: false }
    } else {
      state.refused += 1
      if (!silent && state.refused <= MAX_REFUSALS) {
        throw new Error(`the output is not acceptable: ${problems.join('; ')}. Deliver it again with these corrected; narration may be written freely, utterances may not be touched`)
      }
      output = { segments: narrationChecker.repair(segments.filter(segment => segment.type !== 'utterance' || segment.character !== ''), state.utterances), repaired: true }
    }
    await this.settle(owner, state)
    this.storeOf(owner).completeTurn()
    state.phase = 'done'
    this.consolidateIfDue(owner, state)
    return output
  }
}
