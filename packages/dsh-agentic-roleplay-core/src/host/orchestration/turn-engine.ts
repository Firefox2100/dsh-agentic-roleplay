import { MAX_OOC_ANSWER, MAX_OOC_NOTE, type OocRuling } from '../../shared/ooc.ts'
import { suggestionProblems, tidySuggestions } from './suggestions.ts'
import { fallbackSuggestions } from './suggestion-fallback.ts'
import type { RoutineMove } from '../clock/agenda.ts'
import type { OffSceneItem } from '../clock/offscene.ts'
import { ClockError, type SkipRequest } from '../clock/story-clock.ts'
import { type Boundaries, type CastMember, type CharacterRequest, type CreateReport, type TriggerReport, type TurnStore } from './boundaries.ts'
import { AfterTurnJobs } from './after-turn.ts'
import { type CharacterAction, type CharacterFailure, type CharacterReport, type NarrationSegment, type Outcome, type TurnOutput, type Utterance } from './protocol.ts'
import { askCharacters } from './character-attempt.ts'
import { recordRound } from './round-record.ts'
import { questionRequest } from './question-request.ts'
import { expandWorld, introduceThing, type ThingInput } from './world-making.ts'
import { MAX_REFUSALS, checkedOutput } from './delivery.ts'
import { toolEnabled } from '../../shared/tools.ts'
import { rollView } from '../dice/view.ts'
import { runOffScene } from './off-stage.ts'
import { whereabouts } from './whereabouts.ts'
import { hiddenFrom } from '../decisions/extras.ts'
import { foldSpeakerLabels, repeatsEarlier } from './turn-text.ts'
import type { Attempt, RawSegment, TurnState } from './turn-state.ts'
import { ROLL_FIRST, checkOutcomes, explainPhase, judgeDue, oocBlock, previewDue, rollDue } from './turn-rules.ts'
import { ReflectionRefusedError } from '../sessions/errors.ts'

export type { RawSegment } from './turn-state.ts'

/** Asks one character to act; what the game master calls a character is the character's key. */
export type RunCharacter = (request: CharacterRequest, signal: AbortSignal) => Promise<CharacterAction>

/** Answers a question of the player from what the player's character knows, given as the request a character would be given. */
export type RunAnswer = (request: CharacterRequest, signal: AbortSignal) => Promise<string>

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
    /** What was changed of what is tracked, in words. */
    variables: string[]
    /** What was done with things in this round, and what came of it. */
    things: { character: string; name: string; action: string; summary: string }[]
    /** When the round began and ended in the story, and the zone it is read in. */
    time: { from: number; to: number; zone: string }
    /** Who went somewhere else because their day says so, now that the time moved on. */
    moved: RoutineMove[]
    /** What the world did by itself as a result: triggers whose conditions came true. */
    world: TriggerReport['fired']
  }
}

const MAX_OBJECTIONS = 3
/** The most characters a preview of the scene may have: it is an opening, not the output. */
export const MAX_PREVIEW = 700
export { OFFSTAGE_ROUND } from './off-stage.ts'
/** The most a single round may be said to take: a day. A longer time passing is skipped with `advanceTime`. */
const MAX_ROUND_SECONDS = 86_400
/** The runs of the record keeper that may fail one after another before the rounds waiting for it are given up, so that they cannot pile up for ever. */
const MAX_FAILED_RUNS = 3

/**
 * The loop of one turn: rounds of characters acting, each resolved by the game master
 * (a committed character whose intent failed acts once more within its round), until
 * the output of the turn is delivered. The number of rounds is bounded by the chat's
 * settings. It knows nothing of DSH; characters and storage come in from outside.
 */
export class TurnEngine {
  private readonly states = new Map<string, TurnState>()
  /** The records being written for each chat: one run at a time, behind the story. */
  private readonly chains = new Map<string, Promise<void>>()
  /** The turn last delivered, whose records may still need a run that the next turn has not yet settled. */
  private readonly delivered = new Map<string, TurnState>()
  /** How many runs of the keeper are waiting or running for each chat. */
  private readonly runs = new Map<string, number>()
  private readonly failedRuns = new Map<string, number>()
  private readonly objections = new Map<string, { missing: string; count: number }>()
  /** What runs in the background of each chat and writes to its story, other than the records: fitting in what was made up, and the characters away. */
  private readonly working = new Map<string, Set<Promise<unknown>>>()
  private readonly afterTurn: AfterTurnJobs
  /** What a reflection the player asked for is cancelled with, as `stop` does for the turn. */
  private readonly reflectionCancels = new Map<string, AbortController>()
  /** Chats whose characters away from the player are being asked about what fell due: one run at a time. */
  private readonly offstage = new Set<string>()

  constructor(
    private readonly boundaries: () => Boundaries,
    private readonly stores: (chat: string) => TurnStore | undefined,
    /** Told about a run of the records that failed; the rounds stay queued and the next run writes them with its own. */
    private readonly problem: (message: string) => void = () => undefined,
    /** Told when the records of a chat were written, so that what is new in them can be indexed. */
    private readonly written: (chat: string) => void = () => undefined,
  ) {
    this.afterTurn = new AfterTurnJobs({ boundaries: () => this.boundaries(), stores: chat => this.stores(chat), track: (chat, job) => { this.track(chat, job) }, problem: message => { this.problem(message) }, written: chat => { this.written(chat) } })
  }

  /**
   * The turn is an out-of-character command of the player: nobody is asked to act and no preview is shown. The game master rules on
   * whether it is allowed (`rule`) and, if so, makes it happen with outcomes for any characters, with the world's tools, and says what the player perceives.
   */
  beginOoc(owner: TurnOwner, request: string, question = false): void {
    const state = this.stateFor(owner)
    state.ooc = { request, ...(question ? { question: true as const } : {}) }
    state.previewWanted = false
  }

  /**
   * The answer to an out-of-character question, which is the whole of that turn: nothing in the story changes and nobody is asked to act. It is not the game
   * master's to write, who knows what the player's character does not: it comes from what the player's character knows (what it remembers, knows exists, has
   * on it and sees where it is), so that nothing hidden can be given away.
   * @throws {Error} when the turn is not a question, it was already answered, or the answer is empty.
   */
  async answer(owner: TurnOwner, run: RunAnswer, signal: AbortSignal): Promise<OocRuling> {
    const state = this.stateFor(owner)
    if (state.ooc?.question !== true) throw new Error('this turn is not an out-of-character question: there is nothing to answer')
    if (state.ooc.ruling !== undefined) throw new Error('this question was already answered')
    const text = (await run(await questionRequest(this.boundaries(), this.storeOf(owner), owner, state.ooc.request, signal), signal)).trim()
    if (text === '') throw new Error('the answer is empty')
    if (state.ooc.ruling !== undefined) throw new Error('this question was already answered')
    state.ooc.ruling = { legal: true, note: text.length > MAX_OOC_ANSWER ? `${text.slice(0, MAX_OOC_ANSWER - 1)}…` : text, question: true }
    state.phase = 'between'
    return state.ooc.ruling
  }

  /**
   * The game master's ruling on an out-of-character command: it is legal unless it breaks the rules of the world or the player's own. The reason is
   * what the player is told. Either way the turn goes on to its output; only a legal ruling lets the command change anything.
   * @throws {Error} when the turn is not an out-of-character command, it was already ruled on, or the reason is empty or too long.
   */
  rule(owner: TurnOwner, legal: boolean, reason: string): OocRuling {
    const state = this.stateFor(owner)
    if (state.ooc === undefined) throw new Error('this turn is not an out-of-character command: there is nothing to rule on')
    if (state.ooc.question === true) throw new Error('this turn is an out-of-character question: answer it with ooc_answer')
    if (state.ooc.ruling !== undefined) throw new Error('this command was already ruled on')
    const note = reason.trim()
    if (note === '') throw new Error('give the reason, in plain words to the player')
    if (note.length > MAX_OOC_NOTE) throw new Error(`the reason is longer than ${MAX_OOC_NOTE} characters: say it shortly`)
    state.ooc.ruling = { legal, note }
    state.phase = 'between'
    return state.ooc.ruling
  }

  /**
   * The game master judges what the player's character tries, before anything else in an ordinary turn: it works unless it is not viable or it breaks a rule of the
   * world or of the player. What does not work is played as a failed attempt for the player's character: nobody is asked to act on it.
   * When the action is said to happen at a place (`at`, a place key) and the character is somewhere else, it does not work whatever was judged: the character has to get there first.
   * @throws {Error} when the turn is not an ordinary one, was already judged, the reason is empty, or `at` is not a place.
   */
  judge(owner: TurnOwner, allowed: boolean, reason: string, at?: string, uncertain?: boolean): { allowed: boolean; reason: string; elsewhere?: true; roll?: true } {
    const state = this.stateFor(owner)
    if (state.ooc !== undefined) throw new Error('this turn is an out-of-character ' + (state.ooc.question === true ? 'question: answer it with ooc_answer' : 'command: rule on it with ooc_ruling'))
    if (state.phase !== 'idle') throw new Error('the action is judged first, before anything else')
    if (state.judgement !== undefined) throw new Error('the action was already judged')
    const why = reason.trim()
    if (why === '') throw new Error('give the reason: what the character tries, and the rule or the fact that decides it')
    const place = at?.trim() ?? ''
    if (place !== '') {
      const store = this.storeOf(owner)
      const player = store.cast().find(member => member.character.control === 'player')
      const found = whereabouts(store.story.locations.list(), player?.place?.location, place)
      if (found.kind === 'unknown') throw new Error(`there is no place "${place}" (list_locations shows the keys): name the place where the action happens, or leave "at" out when it happens where the character is`)
      if (found.kind === 'elsewhere') {
        const name = player?.character.name ?? 'The character'
        state.judgement = { allowed: false, reason: `${name} is at ${found.here.name}, not at ${found.target.name} where this happens: ${name} has to go there first` }
        return { ...state.judgement, elsewhere: true }
      }
    }
    state.judgement = { allowed, reason: why }
    const { tools } = this.storeOf(owner).settings()
    if (allowed && uncertain === true && (toolEnabled(tools, 'gameMaster', 'roll_check') || toolEnabled(tools, 'gameMaster', 'roll_dice'))) {
      state.rollWanted = true
      return { ...state.judgement, roll: true }
    }
    return state.judgement
  }

  /**
   * When the chat has the rules checked, the action the game master judged allowed is put against every rule once more by the decision model; a rule it
   * finds likely broken is told to the game master, which judges again (the second judgement stands, whatever it says).
   * @throws {Error} with the rules found, once per turn.
   */
  async checkRules(owner: TurnOwner, allowed: boolean): Promise<void> {
    const state = this.stateFor(owner)
    if (!allowed || state.rulesChecked === true || state.ooc !== undefined || state.phase !== 'idle' || state.judgement !== undefined) return
    const store = this.storeOf(owner)
    if (store.settings().decisions.rules === 'off') return
    state.rulesChecked = true
    const player = store.cast().find(member => member.character.control === 'player')?.character.name ?? ''
    const broken = await this.boundaries().ruleCheck.check({ chat: owner.chat, turn: owner.turn, store, input: state.input ?? '', player }, state.cancel.signal)
    if (broken.length > 0) throw new Error(`a check of the rules found that this action may break: ${broken.map(rule => `"${rule}"`).join('; ')}. Judge it again: if it breaks a rule it is not allowed; if you are sure it does not, call judge_action again with the same answer and give in the reason why the rule does not apply`)
  }

  /** The turn is an ordinary one: the game master judges the player's action before anything else. */
  expectJudgement(owner: TurnOwner): void {
    this.stateFor(owner).judgeWanted = true
  }

  /** Keeps what the player wrote this turn, for the checks of the output. */
  noteInput(owner: TurnOwner, text: string): void {
    this.stateFor(owner).input = text
  }

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
    if (state.ooc !== undefined) throw new Error(state.ooc.question === true ? 'a question asks nobody to act and changes nothing: answer it with ooc_answer' : 'an out-of-character command asks nobody to act: decree what happens with resolve_round, or narrate')
    if (state.phase !== 'idle' && state.phase !== 'between') throw new Error(explainPhase(state, 'activate_characters'))
    if (judgeDue(state)) throw new Error(explainPhase(state, 'activate_characters'))
    if (state.judgement?.allowed === false && state.rounds === 0) throw new Error(`the action cannot work (${state.judgement.reason}): nobody is asked to act on it. Play the failed attempt with resolve_round: one outcome for the player's character, result failed`)
    if (previewDue(state)) throw new Error(explainPhase(state, 'activate_characters'))
    if (rollDue(state, this.storeOf(owner))) throw new Error(ROLL_FIRST)
    const store = this.storeOf(owner)
    const limit = store.settings().maxRounds
    if (state.rounds >= limit) {
      throw new Error(`${state.rounds} round${state.rounds === 1 ? '' : 's'} of characters were already played for this message, which is the most this chat allows: deliver the output with narrate`)
    }
    const situation = input.situation.trim()
    if (situation === '') throw new Error('describe the situation: the characters are told nothing else')
    const cast = store.cast()
    const most = store.settings().maxCharacters
    const keys = this.boundaries().planner.plan({ cast, ...(input.characters === undefined ? {} : { requested: input.characters }) })
    if (keys.length === 0) throw new Error('there is no character to activate')
    if (keys.length > most) throw new Error(`${keys.length} characters were asked, which is more than one round allows (${most}): ask only those the moment actually reaches, and the others in a later round if the story comes to them`)
    const signature = `${[...keys].sort((a, b) => a.localeCompare(b)).join(',')}|${situation.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()}`
    if (repeatsEarlier(signature, state.asked)) throw new Error('the same characters were already asked about the same situation in this message, so nothing new would come of it: say what changed, ask others, or deliver the output with narrate')
    state.situation = situation
    state.cast = cast
    state.recalled.clear()
    state.cues.clear()
    delete state.first
    delete state.second
    const attempt = await this.ask(owner, 1, keys, cast, state, run, signal)
    if (attempt.reports.length === 0) return { attempt: 1, reports: [], failures: attempt.failures }
    state.asked.push(signature)
    state.first = attempt
    state.phase = 'resolving'
    return { attempt: 1, reports: attempt.reports, failures: attempt.failures }
  }

  /**
   * Record the game master's decisions. After the first attempt of a round this may start
   * the retry; after the retry, or when nobody retries, it records the round.
   * @throws {Error} when the outcomes do not cover exactly the characters waiting for one.
   */
  async resolve(owner: TurnOwner, outcomes: readonly Outcome[], run: RunCharacter, signal: AbortSignal, elapsedSeconds?: number): Promise<ResolveReport> {
    const state = this.stateFor(owner)
    const store = this.storeOf(owner)
    if (state.ooc !== undefined) return { done: this.decree(owner, state, outcomes, elapsedSeconds) }
    if (state.phase === 'idle' || state.phase === 'between') {
      if (judgeDue(state) || previewDue(state)) throw new Error(explainPhase(state, 'resolve_round'))
      if (rollDue(state, this.storeOf(owner))) throw new Error(ROLL_FIRST)
      const player = store.cast().find(member => member.character.control === 'player')
      if (player !== undefined && outcomes.length === 1 && outcomes[0]?.character === player.key) return { done: this.resolvePlayer(owner, state, outcomes[0], elapsedSeconds) }
    }
    if (state.phase !== 'resolving' && state.phase !== 'retrying') throw new Error(explainPhase(state, 'resolve_round'))
    const attempt = state.phase === 'resolving' ? state.first : state.second
    if (attempt === undefined) throw new Error('internal: no round to resolve')
    checkOutcomes(attempt, outcomes, store, state.phase === 'resolving' ? this.playerKey(state) : undefined, undefined, state)
    if (elapsedSeconds !== undefined) state.elapsed = this.elapsedChecked(owner, elapsedSeconds)
    attempt.outcomes = [...outcomes]

    if (state.phase === 'resolving') {
      const retrying = this.boundaries().retryPolicy.select({ reports: attempt.reports, outcomes: attempt.outcomes })
        .filter(key => attempt.reports.some(report => report.character === key))
      if (retrying.length > 0) {
        const second = await this.ask(owner, 2, retrying, state.cast, state, run, signal)
        state.second = second
        if (second.reports.length > 0) {
          state.phase = 'retrying'
          return { next: { attempt: 2, reports: second.reports, failures: second.failures } }
        }
      }
    }
    return { done: recordRound(this.storeOf(owner), owner, state, round => this.fire(owner, round)) }
  }

  /**
   * What an out-of-character command decrees, as one round of its own: outcomes for any characters, asked or not, each checked like any other
   * (moves over open ways unless the game master says the story carries them, things that exist and can be reached, what is tracked), applied and recorded.
   * What a character is decreed to do is recorded as forced: it is what happened to it, not what it chose.
   * @throws {Error} when the command was not ruled legal, the limit of rounds is reached, or an outcome is not acceptable.
   */
  private decree(owner: TurnOwner, state: TurnState, outcomes: readonly Outcome[], elapsedSeconds: number | undefined): NonNullable<ResolveReport['done']> {
    const blocked = oocBlock(state)
    if (blocked !== undefined) throw new Error(blocked)
    const store = this.storeOf(owner)
    const limit = store.settings().maxRounds
    if (state.rounds >= limit) throw new Error(`${state.rounds} round${state.rounds === 1 ? '' : 's'} were already decreed for this command, which is the most this chat allows: deliver the output with narrate`)
    state.cast = store.cast()
    if (outcomes.length === 0) throw new Error('decree at least one outcome')
    checkOutcomes({ reports: [], failures: [] }, outcomes, store, undefined, state.cast, state)
    if (elapsedSeconds !== undefined) state.elapsed = this.elapsedChecked(owner, elapsedSeconds)
    state.situation = `By the player's out-of-character command (${state.ooc?.request ?? ''}), the game master decreed:`
    state.recalled.clear()
    delete state.second
    const reports = outcomes.flatMap((outcome): CharacterReport[] => {
      const member = state.cast.find(candidate => candidate.key === outcome.character)
      return member === undefined ? [] : [{ character: member.key, name: member.character.name, intent: outcome.summary, commitment: 'high', ...(member.character.control === 'player' ? {} : { forced: true as const }) }]
    })
    state.first = { reports, failures: [], outcomes: [...outcomes] }
    return recordRound(this.storeOf(owner), owner, state, round => this.fire(owner, round))
  }

  /** Why a lone check of the player's character cannot be rolled, recorded and narrated in one call, if it cannot: nothing is rolled until this is clear. */
  soloCheckProblem(owner: TurnOwner, character: string): string | undefined {
    const state = this.stateFor(owner)
    const store = this.storeOf(owner)
    if (state.ooc !== undefined) return 'this turn is an out-of-character one: use ooc_ruling or ooc_answer'
    if (state.phase !== 'idle' || state.rounds > 0) return 'characters were already played in this turn: roll with roll_check, decide with resolve_round and deliver with narrate'
    if (judgeDue(state) || previewDue(state)) return explainPhase(state, 'resolve_round')
    if (state.judgement?.allowed === false) return `the action cannot work (${state.judgement.reason}): play it as a failed attempt with resolve_round, then narrate`
    const player = store.cast().find(member => member.character.control === 'player')
    return player?.key === character ? undefined : `this is only for the player's character${player === undefined ? '' : ` (${player.key})`}: anyone else's attempt goes through activate_characters`
  }

  /** The key of the player's character. */
  private playerKey(state: TurnState): string | undefined {
    return state.cast.find(member => member.character.control === 'player')?.key
  }

  /**
   * A round of its own for the player's character, when nobody else needs to react: it goes somewhere, takes or
   * puts down something, and what the game master decides about it is recorded like any other round.
   */
  private resolvePlayer(owner: TurnOwner, state: TurnState, outcome: Outcome, elapsedSeconds: number | undefined): NonNullable<ResolveReport['done']> {
    if (state.judgement?.allowed === false && outcome.result !== 'failed') throw new Error(`the action cannot work (${state.judgement.reason}): the outcome for the player's character must be failed`)
    const store = this.storeOf(owner)
    const limit = store.settings().maxRounds
    if (state.rounds >= limit) throw new Error(`${state.rounds} round${state.rounds === 1 ? '' : 's'} were already played for this message, which is the most this chat allows: deliver the output with narrate`)
    state.cast = store.cast()
    const player = state.cast.find(member => member.key === outcome.character)
    checkOutcomes({ reports: [], failures: [] }, [outcome], store, outcome.character, undefined, state)
    if (elapsedSeconds !== undefined) state.elapsed = this.elapsedChecked(owner, elapsedSeconds)
    state.situation = `${player?.character.name ?? outcome.character}: ${outcome.summary}`
    state.recalled.clear()
    delete state.second
    state.first = { reports: [], failures: [], outcomes: [outcome] }
    return recordRound(this.storeOf(owner), owner, state, round => this.fire(owner, round))
  }

  /**
   * The game master shows the player how the scene opens, before anyone is asked: something to read while the rest of the turn is worked out.
   * It is replaced in the view by the output of the turn, which may use it, change it or start over.
   * @throws {Error} when the chat shows no preview, one was already shown, characters were already asked, or the text is empty or too long.
   */
  preview(owner: TurnOwner, text: string): string {
    const state = this.stateFor(owner)
    if (state.ooc !== undefined) throw new Error('an out-of-character turn shows no preview: go on with ' + (state.ooc.question === true ? 'ooc_answer' : 'ooc_ruling'))
    if (judgeDue(state)) throw new Error('judge the action first with judge_action')
    if (!this.storeOf(owner).settings().preview.enabled) throw new Error('this chat shows no preview: go on with activate_characters')
    if (state.previewed) throw new Error('a preview was already shown for this message: go on with activate_characters')
    if (state.phase !== 'idle') throw new Error('the preview comes first, before the characters are asked')
    const shown = text.replace(/\r/g, '').trim()
    if (shown === '') throw new Error('write the preview: a few sentences that set the scene')
    if (shown.length > MAX_PREVIEW) throw new Error(`keep the preview to ${MAX_PREVIEW} characters: it is an opening, the output comes later`)
    state.previewed = true
    return shown
  }

  /** At the start of a turn, after the clock caught up: the triggers whose conditions came true while the player was away or since the last round. */
  fireAtStart(owner: TurnOwner): TriggerReport['fired'] {
    return this.fire(owner, 0)
  }

  /** The world acts: the triggers whose conditions just came true fire. A failure to look at them is reported and the story goes on. */
  private fire(owner: TurnOwner, round: number): TriggerReport['fired'] {
    try {
      return this.storeOf(owner).runTriggers(owner.turn, round).fired
    } catch (error) {
      this.problem(`the triggers could not be looked at: ${error instanceof Error ? error.message : String(error)}`)
      return []
    }
  }

  /** How long a round took, as the game master said it. @throws {Error} when the time is real or the number is not one. */
  private elapsedChecked(owner: TurnOwner, seconds: number): number {
    if (this.storeOf(owner).time(owner.turn).mode === 'real') throw new Error('the story\'s time follows the wall clock: leave elapsed_seconds out')
    if (!Number.isInteger(seconds) || seconds < 0 || seconds > MAX_ROUND_SECONDS) throw new Error(`elapsed_seconds must be a whole number of seconds from 0 to ${MAX_ROUND_SECONDS}; to pass more time than that, use advance_time`)
    return seconds
  }

  /**
   * Skip ahead in the story's time, between rounds: the player sleeps till morning, a journey takes days.
   * @throws {Error} when a round is open, the turn is over, the time follows the wall clock, or the request is not acceptable.
   */
  advanceTime(owner: TurnOwner, request: SkipRequest): { from: number; to: number; zone: string; reason: string; moved: RoutineMove[]; world: TriggerReport['fired'] } {
    const state = this.stateFor(owner)
    if (state.phase === 'resolving' || state.phase === 'retrying') throw new Error('resolve the round first: time is skipped between rounds, not in the middle of one')
    if (state.phase === 'done' || state.phase === 'skipped') throw new Error(explainPhase(state, undefined))
    const blocked = oocBlock(state)
    if (blocked !== undefined) throw new Error(blocked)
    try {
      const skipped = this.storeOf(owner).skipTime(owner.turn, state.rounds, request)
      return { ...skipped, world: this.fire(owner, state.rounds) }
    } catch (error) {
      throw error instanceof ClockError ? new Error(error.message) : error
    }
  }

  /**
   * Take the output of the turn from the game master. An output that changes, drops, invents
   * or reorders an utterance is refused with what is wrong, so that the game master can
   * correct it; after it was refused a few times it is corrected here instead. Without
   * segments, the narrator boundary is asked to write it.
   * @throws {Error} naming every problem, while the game master may still correct it.
   */
  async narrate(owner: TurnOwner, segments: readonly RawSegment[], run?: RunCharacter, addressed: readonly number[] = []): Promise<TurnOutput> {
    const state = this.stateFor(owner)
    if (state.phase !== 'between') throw new Error(explainPhase(state, 'narrate'))
    const pending = new Set(this.storeOf(owner).pendingBeats().map(beat => beat.id))
    const unknown = addressed.filter(id => !pending.has(id))
    if (unknown.length > 0) throw new Error(`addressed: ${unknown.join(', ')} ${unknown.length === 1 ? 'is' : 'are'} not ${unknown.length === 1 ? 'a beat' : 'beats'} still to weave in (the scene lists them)`)
    state.addressed = [...new Set(addressed)]
    if (state.ooc !== undefined) {
      if (state.ooc.question === true && segments.length > 0) throw new Error('a question is answered with ooc_answer: deliver no segments, the player is shown the answer')
      if (state.ooc.ruling?.legal !== true && segments.length > 0) throw new Error('the command was refused: deliver no segments, the player is told why')
      if (segments.some(segment => segment.type === 'utterance')) throw new Error('nobody was asked to speak in an out-of-character command: narrate only what the player perceives')
      return await this.deliver(owner, state, segments.map((segment): NarrationSegment => ({ type: 'narration', text: segment.text })), true, run)
    }
    if (segments.length === 0) {
      const written = await this.boundaries().narrator.narrate({ situations: state.situations, outcomes: state.outcomes, reports: state.reports, utterances: state.utterances })
      if (written === undefined) throw new Error('deliver the output: give its segments')
      return await this.deliver(owner, state, written, true, run)
    }
    const typed = foldSpeakerLabels(segments, state.cast).map((segment): NarrationSegment => segment.type === 'utterance'
      ? { type: 'utterance', character: segment.character ?? '', name: state.cast.find(member => member.key === segment.character)?.character.name ?? segment.character ?? '', text: segment.text }
      : { type: 'narration', text: segment.text })
    return await this.deliver(owner, state, typed, false, run)
  }

  /**
   * The game master asks for something to be made up (a place the story has gone to, someone who has joined): the world author decides whether the
   * story genuinely needs it, and makes it or says why not. @throws {Error} when the world is closed, the turn's limit is reached or a round is open.
   */
  async expand(owner: TurnOwner, input: { need: string; what: string }, signal: AbortSignal): Promise<CreateReport> {
    return await expandWorld(this.boundaries(), this.storeOf(owner), this.stateFor(owner), owner, input, signal)
  }

  /** The game master introduces a thing the story uses, with no world author asked. @throws {Error} when the world is closed, a round is open, or the thing cannot be put where it was said. */
  introduce(owner: TurnOwner, input: ThingInput): { key: string; name: string; where: string } {
    return introduceThing(this.storeOf(owner), this.stateFor(owner), owner, input)
  }

  /** Whether made-up characters and places are waiting to be fitted into the world. */
  waitingToFit(owner: TurnOwner): number {
    return this.stores(owner.chat)?.story.consolidation.pending().length ?? 0
  }

  /**
   * After the turn, in the background: characters away from the player's character, for whom something fell due (a commitment whose
   * time has come, a deadline that passed), are asked what they do about it, as many as the chat allows. What they decide is applied
   * (their activity, and a move to where the commitment was when they mean to keep it) and recorded as a round only they perceive;
   * the record keeper writes it, which is also where the commitment is concluded. A failed run leaves everything as it was.
   */
  private offSceneIfDue(owner: TurnOwner, state: TurnState, run: RunCharacter): void {
    const store = this.stores(owner.chat)
    if (store === undefined || this.offstage.has(owner.chat)) return
    const { perTurn: limit } = store.settings().offstage
    if (limit === 0) return
    const due = store.dueOffScene(owner.turn)
    if (due.length === 0) return
    this.offstage.add(owner.chat)
    this.track(owner.chat, this.runOffScene(owner, state, store, due, limit, run)
      .catch((error: unknown) => {
        if (!state.cancel.signal.aborted) this.problem(`characters away from the player were not asked about what fell due: ${error instanceof Error ? error.message : String(error)}`)
      })
      .finally(() => { this.offstage.delete(owner.chat) }))
  }

  private runOffScene(owner: TurnOwner, state: TurnState, store: TurnStore, due: readonly OffSceneItem[], limit: number, run: RunCharacter): Promise<void> {
    return runOffScene({
      ask: (group, cast, asked, summary) => this.ask(owner, 1, group, cast, asked, run, state.cancel.signal, summary),
      write: () => { this.write(owner, state) },
      stillThis: () => this.states.get(owner.chat) === state,
    }, owner, state, store, due, limit)
  }

  /** What still has to happen before the turn may end, or nothing when it may. */
  missing(owner: TurnOwner): string | undefined {
    const state = this.stateFor(owner)
    if (state.phase === 'done' || state.phase === 'skipped') return undefined
    return explainPhase(state, undefined)
  }

  /** Wait until the records being written are written or have failed. */
  async flush(owner: TurnOwner): Promise<void> {
    await this.chains.get(owner.chat)
  }

  /**
   * Wait until the records of the rounds recorded so far are written or have failed, and run once more for what is still
   * waiting when the game master asked for it or too many rounds are waiting. A turn starts without it (the game master
   * judges and previews meanwhile); it is called before anything that recalls or changes the story, so those wait for the
   * keeper and nothing else does. A call in the turn that was just delivered only waits for a run in flight.
   */
  async settle(chat: string, turn?: number): Promise<void> {
    await this.chains.get(chat)
    const state = this.delivered.get(chat)
    const store = this.stores(chat)
    if (state === undefined || store === undefined || (turn !== undefined && state.turn >= turn)) return
    this.delivered.delete(chat)
    const waiting = store.pendingCommits().length
    if (waiting > 0 && (state.requested || waiting >= store.settings().memory.backlogRounds)) {
      this.write({ chat, turn: state.turn }, state)
      await this.chains.get(chat)
    }
  }

  /**
   * Starts a reflection the player asked for: the records still waiting are written first, so that what the characters took in is there to
   * sort, and the pass then runs in the background. @throws {ReflectionRefusedError} while a turn is being played, or when a pass is already running.
   */
  async reflect(chat: string): Promise<void> {
    const store = this.stores(chat)
    if (store === undefined) throw new Error(`no story for chat ${chat}`)
    if (this.playing(chat)) throw new ReflectionRefusedError('a turn is being played; reflect when it is over')
    const delivered = this.delivered.get(chat)
    if (delivered !== undefined && store.pendingCommits().length > 0) this.write({ chat, turn: delivered.turn }, delivered)
    await this.chains.get(chat)
    const cancel = new AbortController()
    this.reflectionCancels.set(chat, cancel)
    this.afterTurn.reflectNow({ chat, turn: store.story.metadata.get().turns }, cancel.signal)
  }

  /** Whether a turn is being played: characters are being asked or the game master is between rounds. */
  playing(chat: string): boolean {
    const turning = this.states.get(chat)
    return turning !== undefined && ['resolving', 'retrying', 'between'].includes(turning.phase)
  }

  /** Whether a reflection is running for the chat. */
  reflecting(chat: string): boolean {
    return this.afterTurn.isReflecting(chat)
  }

  /** Wait until the run of the keeper in flight, if any, has ended; nothing is started. */
  async idle(chat: string): Promise<void> {
    await this.chains.get(chat)
  }

  /** What has been said in the turn so far. */
  spoken(owner: TurnOwner): readonly Utterance[] {
    return this.stateFor(owner).utterances
  }

  /**
   * Whether the game master may still be turned back, counting this objection. Only objections that get nowhere count: a turn that has moved on since the
   * last one (what is missing changed) starts the count again, because a turn cut short by a model's output limit has to be steered through every step.
   */
  object(owner: TurnOwner, missing: string): boolean {
    const key = `${owner.chat}#${owner.turn}`
    const last = this.objections.get(key)
    const count = last?.missing === missing ? last.count + 1 : 1
    this.objections.set(key, { missing, count })
    return count <= MAX_OBJECTIONS
  }

  private track(chat: string, job: Promise<unknown>): void {
    const set = this.working.get(chat) ?? new Set<Promise<unknown>>()
    this.working.set(chat, set)
    set.add(job)
    void job.finally(() => { set.delete(job) })
  }

  /** Stops what the turn of a chat has in flight: nothing it started is cancelled halfway through a write, but nothing new is asked of a model. */
  stop(chat: string): void {
    this.states.get(chat)?.cancel.abort()
    this.reflectionCancels.get(chat)?.abort()
  }

  /** Resolves when nothing of the chat writes to its story any more: the records, what was made up being fitted in, the characters away, the suggestions. */
  async quiesce(chat: string): Promise<void> {
    for (;;) {
      const jobs = [...(this.working.get(chat) ?? []), ...(this.chains.has(chat) ? [this.chains.get(chat)!] : [])]
      if (jobs.length === 0 || (this.runs.get(chat) ?? 0) === 0 && (this.working.get(chat)?.size ?? 0) === 0) return
      await Promise.allSettled(jobs)
    }
  }

  forget(chat: string): void {
    this.states.get(chat)?.cancel.abort()
    this.reflectionCancels.get(chat)?.abort()
    this.reflectionCancels.delete(chat)
    this.states.delete(chat)
    this.chains.delete(chat)
    this.delivered.delete(chat)
    this.runs.delete(chat)
    this.working.delete(chat)
    for (const key of this.objections.keys()) if (key.startsWith(`${chat}#`)) this.objections.delete(key)
  }

  private stateFor({ chat, turn }: TurnOwner): TurnState {
    const known = this.states.get(chat)
    if (known?.turn === turn) return known
    const fresh: TurnState = { turn, phase: 'idle', cast: [], rounds: 0, situations: [], asked: [], situation: '', history: [], reports: [], outcomes: [], utterances: [], cited: new Set(), reported: new Set(), refused: 0, previewed: false, previewWanted: this.stores(chat)?.settings().preview.enabled ?? false, focus: [], requested: false, offstage: 0, cancel: new AbortController(), recalled: new Map(), cues: new Map(), addressed: [] }
    this.states.set(chat, fresh)
    return fresh
  }

  private storeOf(owner: TurnOwner): TurnStore {
    const store = this.stores(owner.chat)
    if (store === undefined) throw new Error('this chat is not a roleplay session')
    return store
  }

  private ask(owner: TurnOwner, number: 1 | 2, keys: readonly string[], cast: readonly CastMember[], state: TurnState, run: RunCharacter, signal: AbortSignal, away = false): Promise<Attempt> {
    return askCharacters({ boundaries: this.boundaries(), store: this.stores(owner.chat), storeOf: o => this.storeOf(o), problem: message => { this.problem(message) } }, owner, number, keys, cast, state, run, signal, away)
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
    if (this.storeOf(owner).settings().background.concurrent) this.write(owner, state)
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
    this.runs.set(owner.chat, (this.runs.get(owner.chat) ?? 0) + 1)
    this.chains.set(owner.chat, (this.chains.get(owner.chat) ?? Promise.resolve()).then(async () => {
      const store = this.stores(owner.chat)
      const rounds = store?.pendingCommits() ?? []
      if (store === undefined || rounds.length === 0) return
      try {
        await this.boundaries().committer.commit({ chat: owner.chat, rounds, store, ...(state.focus.length === 0 ? {} : { focus: [...state.focus] }) }, state.cancel.signal)
        store.completeCommits(rounds)
        state.focus = []
        this.failedRuns.delete(owner.chat)
        this.written(owner.chat)
      } catch (error) {
        if (state.cancel.signal.aborted) return
        const failed = (this.failedRuns.get(owner.chat) ?? 0) + 1
        const label = rounds.map(round => `${round.turn}.${round.round}`).join(', ')
        this.problem(`the records of ${label} were not written: ${error instanceof Error ? error.message : String(error)}`)
        if (failed < MAX_FAILED_RUNS) { this.failedRuns.set(owner.chat, failed); return }
        this.failedRuns.delete(owner.chat)
        store.completeCommits(rounds)
        this.problem(`the records of ${label} were given up after ${MAX_FAILED_RUNS} failed runs: what the game master decided stands, but those rounds are not in the memory`)
      }
    }).finally(() => { this.runs.set(owner.chat, (this.runs.get(owner.chat) ?? 1) - 1) }))
  }

  /** After the output is delivered: the player is offered what to do next, made in the background from what they just read. */
  private suggestAfter(owner: TurnOwner, state: TurnState, output: TurnOutput): void {
    const store = this.stores(owner.chat)
    const count = store?.settings().suggestions.count ?? 0
    if (store === undefined || count === 0) return
    this.track(owner.chat, this.boundaries().suggester.suggest({ chat: owner.chat, turn: owner.turn, store, count, output }, state.cancel.signal)
      .then((made) => {
        if (made.length === 0 || this.states.get(owner.chat) !== state) return
        const lines = tidySuggestions(made)
        const problems = suggestionProblems(lines, count)
        if (problems.length > 0) throw new Error(problems.join('; '))
        store.putNote({ kind: 'suggestions', turn: owner.turn, lines })
      })
      .catch((error: unknown) => {
        if (state.cancel.signal.aborted) return
        this.problem(`suggestions for turn ${owner.turn} were not made: ${error instanceof Error ? error.message : String(error)}`)
        if (this.states.get(owner.chat) !== state) return
        try {
          const lines = fallbackSuggestions(store, count)
          if (lines.length > 0) store.putNote({ kind: 'suggestions', turn: owner.turn, lines })
        } catch (failed) {
          this.problem(`suggestions for turn ${owner.turn} could not be made from the story either: ${failed instanceof Error ? failed.message : String(failed)}`)
        }
      }))
  }

  /** After the output is delivered: start writing what is due, without waiting for it. */
  private startDueWrite(owner: TurnOwner, state: TurnState): void {
    const store = this.stores(owner.chat)
    const waiting = store?.pendingCommits().length ?? 0
    if ((this.runs.get(owner.chat) ?? 0) === 0 && store !== undefined && waiting > 0 && (state.requested || waiting >= store.settings().memory.backlogRounds)) this.write(owner, state)
  }

  /**
   * Has the output checked for the faults the chat switched on, and sends it back to the game master when it has one, as often as a
   * refusal may be made; past that, or for an output a narrator wrote or one that was corrected for the game master, it goes as it is.
   */
  private async gate(owner: TurnOwner, state: TurnState, output: TurnOutput, silent: boolean): Promise<void> {
    if (silent || output.repaired || state.ooc !== undefined || state.refused >= MAX_REFUSALS) return
    const store = this.storeOf(owner)
    const narration = output.segments.flatMap(segment => (segment.type === 'narration' ? [segment.text] : [])).join('\n')
    const passage = output.segments.map(segment => (segment.type === 'narration' ? segment.text : `${segment.name}: ${segment.text}`)).join('\n')
    const playing = state.cast.find(member => member.character.control === 'player')?.character
    const player = playing?.name ?? ''
    const secrets = playing === undefined || state.secretsFound === true || store.settings().decisions.secrets === 'off' ? [] : hiddenFrom(store.story, playing.id, passage)
    const findings = await this.boundaries().outputGate.check({ chat: owner.chat, turn: owner.turn, store, input: state.input ?? '', player, narration, passage, secrets }, state.cancel.signal)
    if (findings.length === 0) return
    if (findings.some(finding => finding.gate === 'secrets')) state.secretsFound = true
    state.refused += 1
    throw new Error(`the output is not acceptable: ${findings.map(finding => finding.message).join('; ')}. Deliver it again with this corrected; utterances may not be touched`)
  }

  private async deliver(owner: TurnOwner, state: TurnState, segments: readonly NarrationSegment[], silent: boolean, run?: RunCharacter): Promise<TurnOutput> {
    let output = checkedOutput(this.boundaries().narrationChecker, this.storeOf(owner).settings().prompts.language, state, segments, silent)
    await this.gate(owner, state, output, silent)
    if (state.ooc?.ruling !== undefined) output = { ...output, ooc: state.ooc.ruling }
    const store = this.storeOf(owner)
    const rolled = store.settings().dice.visibility === 'card' ? store.story.dice.rolls({ turn: owner.turn }) : []
    if (rolled.length > 0) output = { ...output, rolls: rolled.map(rollView) }
    this.storeOf(owner).completeTurn()
    this.storeOf(owner).resolveBeats(state.addressed)
    state.phase = 'done'
    this.suggestAfter(owner, state, output)
    this.startDueWrite(owner, state)
    this.delivered.set(owner.chat, state)
    this.afterTurn.start(owner, state.cancel.signal)
    if (run !== undefined) this.offSceneIfDue(owner, state, run)
    return output
  }
}
