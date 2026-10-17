import type { Recalled } from '@dsh-agentic-roleplay/state'
import type { OocRuling } from '../../shared/ooc.ts'
import type { CastMember, Reaction } from './boundaries.ts'
import type { CharacterFailure, CharacterReport, Outcome, Utterance } from './protocol.ts'

/** One part of the output as the game master delivers it, before it is checked. */
export interface RawSegment {
  type: 'utterance' | 'narration'
  character?: string
  text: string
}

/** Between rounds the game master chooses: another round of characters, or the output. */
export type Phase = 'idle' | 'resolving' | 'retrying' | 'between' | 'done' | 'skipped'

export interface Attempt {
  reports: CharacterReport[]
  failures: CharacterFailure[]
  outcomes?: Outcome[]
}

export interface TurnState {
  turn: number
  phase: Phase
  cast: CastMember[]
  /** The rounds recorded so far. */
  rounds: number
  situations: string[]
  /** Who was asked about what in the rounds of the turn, as `keys|situation`, so that the same question is not asked twice. */
  asked: string[]
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
  /** What the game master said is worth keeping, when it asked for the records to be written. */
  focus: string[]
  /** How long the round in progress took, in seconds, when the game master said. */
  elapsed?: number
  /** Whether the game master already showed the player a preview of the scene in this turn. */
  previewed: boolean
  /** Whether the chat asked for a preview when the turn began: the characters are not asked before it is shown. */
  previewWanted: boolean
  /** Whether the game master asked for the records to be written in this turn. */
  requested: boolean
  /** How many rounds off stage were recorded in this turn. */
  offstage: number
  cancel: AbortController
  /** What each character was reminded of in the first attempt of the round, so a retry is reminded of the same. */
  recalled: Map<string, readonly Recalled[]>
  /** What the world made each character notice in the first attempt of the round, so a retry is told the same. */
  cues: Map<string, readonly string[]>
  /** The beats the game master said it wove into the output it is delivering. */
  addressed: number[]
  /** Set when the turn is an out-of-character command or question of the player: what it asks, and how the game master ruled on it or answered it. */
  ooc?: { request: string; question?: true; ruling?: OocRuling }
  /** The game master's judgment of the player's action, which it gives before anything else in an ordinary turn. */
  judgement?: { allowed: boolean; reason: string }
  /** Whether the game master has to judge the player's action before anything else: the loop asks for it at the start of an ordinary turn. */
  judgeWanted?: true
}
