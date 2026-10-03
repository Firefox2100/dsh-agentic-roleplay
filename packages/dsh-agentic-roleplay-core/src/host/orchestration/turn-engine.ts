import type { Boundaries, CastMember, CharacterRequest, Reaction, TurnStore } from './boundaries.ts'
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
}

const MAX_OBJECTIONS = 3
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

  constructor(
    private readonly boundaries: () => Boundaries,
    private readonly stores: (chat: string) => TurnStore | undefined,
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
    delete state.first
    delete state.second
    const attempt = await this.runAttempt(1, keys, cast, state, run, signal)
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
    this.check(attempt, outcomes)
    attempt.outcomes = [...outcomes]

    if (state.phase === 'resolving') {
      const retrying = this.boundaries().retryPolicy.select({ reports: attempt.reports, outcomes: attempt.outcomes })
        .filter(key => attempt.reports.some(report => report.character === key))
      if (retrying.length > 0) {
        const second = await this.runAttempt(2, retrying, state.cast, state, run, signal)
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
      return this.deliver(owner, state, written, true)
    }
    const typed = segments.map((segment): NarrationSegment => segment.type === 'utterance'
      ? { type: 'utterance', character: segment.character ?? '', name: state.cast.find(member => member.key === segment.character)?.character.name ?? segment.character ?? '', text: segment.text }
      : { type: 'narration', text: segment.text })
    return this.deliver(owner, state, typed, false)
  }

  /** What still has to happen before the turn may end, or nothing when it may. */
  missing(owner: TurnOwner): string | undefined {
    const state = this.stateFor(owner)
    if (state.phase === 'done' || state.phase === 'skipped') return undefined
    return this.explain(state, undefined)
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
    this.states.delete(chat)
    for (const key of this.objections.keys()) if (key.startsWith(`${chat}#`)) this.objections.delete(key)
  }

  private stateFor({ chat, turn }: TurnOwner): TurnState {
    const known = this.states.get(chat)
    if (known?.turn === turn) return known
    const fresh: TurnState = { turn, phase: 'idle', cast: [], rounds: 0, situations: [], situation: '', history: [], reports: [], outcomes: [], utterances: [], refused: 0 }
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

  private check(attempt: Attempt, outcomes: readonly Outcome[]): void {
    const expected = attempt.reports.map(report => report.character)
    const given = outcomes.map(outcome => outcome.character)
    const problems = [
      ...expected.filter(key => !given.includes(key)).map(key => `missing an outcome for ${key}`),
      ...[...new Set(given.filter(key => !expected.includes(key)))].map(key => `${key} is not waiting for an outcome`),
      ...[...new Set(given.filter((key, index) => given.indexOf(key) !== index))].map(key => `more than one outcome for ${key}`),
      ...outcomes.filter(outcome => !RESULTS.includes(outcome.result)).map(outcome => `${outcome.character}: unknown result "${outcome.result}"`),
      ...outcomes.filter(outcome => outcome.summary.trim() === '').map(outcome => `${outcome.character}: say what happens`),
    ]
    if (problems.length > 0) throw new Error(`the outcomes are not acceptable: ${problems.join('; ')} (expected exactly: ${expected.join(', ')})`)
  }

  /** Every character acts at the same time; one that fails or answers badly is reported, not fatal. */
  private async runAttempt(number: 1 | 2, keys: readonly string[], cast: readonly CastMember[], state: TurnState, run: RunCharacter, signal: AbortSignal): Promise<Attempt> {
    const { outputValidator } = this.boundaries()
    const reaction = number === 2 ? this.reactions(state) : undefined
    const answers = await Promise.all(keys.map(async (key): Promise<CharacterReport | CharacterFailure> => {
      const member = cast.find(candidate => candidate.key === key)
      if (member === undefined) return { character: key, name: key, reason: 'no such character' }
      const previous = number === 2 ? state.first?.reports.find(report => report.character === key) : undefined
      const request: CharacterRequest = {
        member, cast, situation: state.situation, attempt: number,
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
    const updates = [...decided.values()].flatMap(({ outcome }) => {
      const member = state.cast.find(candidate => candidate.key === outcome.character)
      if (member === undefined) return []
      return [{
        character: member.character.id,
        patch: { activity: outcome.summary, ...(outcome.publicState === undefined || outcome.publicState.trim() === '' ? {} : { publicState: outcome.publicState.trim() }) },
      }]
    })
    store.commit(updates)
    const limit = store.settings().maxRounds
    const round = state.rounds + 1
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
    return { round, limit, updated: [...decided.keys()], retryFailures: state.second?.failures ?? [], utterances: spoken, spoken: [...state.utterances] }
  }

  private deliver(owner: TurnOwner, state: TurnState, segments: readonly NarrationSegment[], silent: boolean): TurnOutput {
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
    this.storeOf(owner).completeTurn()
    state.phase = 'done'
    return output
  }
}
