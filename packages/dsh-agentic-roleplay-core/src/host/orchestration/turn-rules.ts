import { mentioned } from '@dsh-agentic-roleplay/state'
import type { CastMember, KnownRelationship, Reaction, TurnStore } from './boundaries.ts'
import { referent } from './referent.ts'
import { RESULTS, type CharacterReport, type Outcome } from './protocol.ts'
import type { Attempt, TurnState } from './turn-state.ts'

/** Whether the game master still has to judge the player's action. */
export function judgeDue(state: TurnState): boolean {
  return state.judgeWanted === true && state.phase === 'idle' && state.ooc === undefined && state.judgement === undefined
}

/** Why an out-of-character command may not change anything yet, when it may not. */
export function oocBlock(state: TurnState): string | undefined {
  if (state.ooc === undefined) return undefined
  if (state.ooc.question === true) return state.ooc.ruling === undefined ? 'this turn is an out-of-character question: answer it first with ooc_answer' : 'a question changes nothing: call narrate with no segments'
  if (state.ooc.ruling === undefined) return 'this turn is an out-of-character command: rule on it first with ooc_ruling'
  return state.ooc.ruling.legal ? undefined : 'the command was refused: nothing changes; call narrate with no segments to tell the player'
}

/** Whether the chat wants a preview of the scene and the game master has not shown it yet. */
export function previewDue(state: TurnState): boolean {
  return state.phase === 'idle' && state.previewWanted && !state.previewed && state.judgement?.allowed !== false
}

export function explainPhase(state: TurnState, attempted: 'activate_characters' | 'resolve_round' | 'narrate' | undefined): string {
  if (state.ooc?.question === true && (state.phase === 'idle' || state.phase === 'between')) {
    return state.ooc.ruling === undefined ? 'this turn is an out-of-character question: answer it first with ooc_answer' : 'a question changes nothing: call narrate with no segments'
  }
  if (state.ooc !== undefined && (state.phase === 'idle' || state.phase === 'between')) {
    return state.ooc.ruling === undefined
      ? 'this turn is an out-of-character command: rule on it first with ooc_ruling'
      : state.ooc.ruling.legal
        ? 'make the command happen with resolve_round, expand_world or advance_time, then call narrate with what the player perceives (narration only)'
        : 'the command was refused: call narrate with no segments'
  }
  const waiting = (attempt: Attempt | undefined): string => (attempt?.reports ?? []).map(report => report.character).join(', ')
  switch (state.phase) {
    case 'idle': return judgeDue(state)
      ? 'call judge_action first: does what the player\'s character tries work? It does not when it is not viable or it breaks a rule of the world or of the player'
      : previewDue(state)
      ? 'call preview_scene first: two or three sentences that show the player how the scene opens, before the characters are asked'
      : state.judgement?.allowed === false && attempted !== 'activate_characters'
      ? `the attempt does not work (${state.judgement.reason}): call resolve_round with one outcome, for the player's character only (result failed, a sentence on what it does and why nothing comes of it)${attempted === 'narrate' ? ', then narrate' : ''}`
      : attempted === 'activate_characters' || attempted === undefined
      ? 'call activate_characters to let the characters act'
      : attempted === 'narrate'
      ? 'nothing to deliver yet: call activate_characters to let the characters act, or, when nobody else needs to react, call resolve_round with an outcome for the player\'s character alone, and then narrate'
      : 'nothing to resolve yet: call activate_characters first'
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
      : `call narrate with the output of the turn${mustSay(state)}${canContinue(state)}`
    case 'done': return 'this turn is already recorded'
    case 'skipped': return 'this turn needs no round'
  }
}

export function canContinue(state: TurnState): string {
  const left = (state.limit ?? 0) - state.rounds
  return left > 0 ? `, or call activate_characters if the story genuinely needs them again (${left} round(s) left)` : ''
}

export function mustSay(state: TurnState): string {
  return state.utterances.length === 0
    ? ''
    : `; it must carry these utterances exactly, in this order: ${state.utterances.map(utterance => `${utterance.name}: "${utterance.text}"`).join(' | ')}`
}

/** `player` is the key of the player's character when an outcome for it is acceptable: it is not asked to act, but what it did can move it or have it handle things. */
export function checkOutcomes(attempt: Attempt, outcomes: readonly Outcome[], store: TurnStore, player?: string, decreed?: readonly CastMember[]): void {
  const expected = decreed === undefined ? attempt.reports.map(report => report.character) : [...new Set(outcomes.map(outcome => outcome.character))]
  const unknown = decreed === undefined ? [] : [...new Set(outcomes.map(outcome => outcome.character))].filter(key => !decreed.some(member => member.key === key)).map(key => `${key} is not a character of the story`)
  const given = outcomes.filter(outcome => outcome.character !== player).map(outcome => outcome.character)
  const problems = [
    ...unknown,
    ...(outcomes.filter(outcome => outcome.character === player).length > 1 ? [`more than one outcome for ${player}`] : []),
    ...expected.filter(key => !given.includes(key)).map(key => `missing an outcome for ${key}`),
    ...[...new Set(given.filter(key => !expected.includes(key)))].map(key => `${key} is not waiting for an outcome`),
    ...[...new Set(given.filter((key, index) => given.indexOf(key) !== index))].map(key => `more than one outcome for ${key}`),
    ...outcomes.filter(outcome => !RESULTS.includes(outcome.result)).map(outcome => `${outcome.character}: unknown result "${outcome.result}"`),
    ...outcomes.filter(outcome => outcome.summary.trim() === '').map(outcome => `${outcome.character}: say what happens`),
    ...outcomes.flatMap(outcome => moveProblems(outcome, store)),
    ...itemProblems(outcomes, store),
    ...outcomes.flatMap(outcome => store.checkVariableChanges(outcome.variableChanges ?? []).map(problem => `${outcome.character}: ${problem}`)),
  ]
  if (problems.length > 0) throw new Error(`the outcomes are not acceptable: ${problems.join('; ')} (expected exactly: ${expected.join(', ')})`)
}

/** Why a character cannot go where the outcome sends it, if it cannot: the game master hears it before the round is recorded. */
export function moveProblems(outcome: Outcome, store: TurnStore): string[] {
  if (outcome.moveTo === undefined) return []
  if (outcome.result === 'failed') return [`${outcome.character}: its intent failed, so it does not go anywhere: leave moves_to out`]
  const checked = store.checkMove(outcome.character, outcome.moveTo)
  return checked.ok ? [] : checked.problems.map(problem => `${outcome.character}: cannot go to ${outcome.moveTo?.location}: ${problem}`)
}

/** Why what the outcomes do with things cannot be done, if it cannot: tried in order, each seeing what the one before did. */
export function itemProblems(outcomes: readonly Outcome[], store: TurnStore): string[] {
  const entries = outcomes.flatMap(outcome => (outcome.itemChanges === undefined || outcome.itemChanges.length === 0 || outcome.result === 'failed' ? [] : [{ character: outcome.character, changes: outcome.itemChanges }]))
  const failed = outcomes.filter(outcome => outcome.result === 'failed' && (outcome.itemChanges?.length ?? 0) > 0).map(outcome => `${outcome.character}: its intent failed, so it does nothing with things: leave item_changes out`)
  if (entries.length === 0) return failed
  const checked = store.checkItemChanges(entries)
  return checked.ok ? failed : [...failed, ...checked.problems]
}

/** What the world made a character notice: taken up in the first attempt of a round, and told the same again on the retry. */
export function cuesOf(state: TurnState, key: string, member: CastMember, store: TurnStore | undefined, attempt: 1 | 2): readonly string[] {
  if (attempt === 2 || store === undefined) return state.cues.get(key) ?? []
  const pending = store.cuesFor(member.character.id)
  if (pending.length === 0) return []
  store.doneCues(pending.map(cue => cue.id))
  const texts = pending.map(cue => cue.text)
  state.cues.set(key, texts)
  return texts
}

/** How a character sees people present or explicitly in the moment, for those it has a profile of. */
export function knownRelationships(member: CastMember, company: readonly CastMember[], situation: string, cast: readonly CastMember[], store: TurnStore): KnownRelationship[] {
  const present = new Set(company.map(candidate => candidate.character.id))
  const relevant = mentioned(situation, cast.map(candidate => candidate.character))
  return store.story.relationships.from(member.character.id).flatMap((relation) => {
    if (!present.has(relation.toId) && !relevant.has(relation.toId)) return []
    const other = cast.find(candidate => candidate.character.id === relation.toId)
    return other === undefined || other.key === member.key ? [] : [{ name: referent(other.character), label: relation.label, summary: relation.summary, present: present.has(relation.toId), familiarity: relation.familiarity, trust: relation.trust, affinity: relation.affinity, tension: relation.tension }]
  })
}

export function reactions(state: TurnState): Reaction[] {
  const first = state.first
  return (first?.outcomes ?? []).flatMap((outcome) => {
    const report = first?.reports.find(candidate => candidate.character === outcome.character)
    return report === undefined ? [] : [{ character: report.character, name: report.name, intent: report.intent, ...(report.utterance === undefined ? {} : { utterance: report.utterance }), result: outcome.result, summary: outcome.summary }]
  })
}

/** The final decision for each character of the round: the retry's replaces the first attempt's. */
/** The player's character is never asked to act, so what the game master decided it did stands in for its report. */
export function playerReport(state: TurnState, outcome: Outcome): CharacterReport | undefined {
  const member = state.cast.find(candidate => candidate.key === outcome.character && candidate.character.control === 'player')
  return member === undefined ? undefined : { character: member.key, name: member.character.name, intent: outcome.summary, commitment: 'high' }
}

export function decisions(state: TurnState): Map<string, { outcome: Outcome; report: CharacterReport }> {
  const decided = new Map<string, { outcome: Outcome; report: CharacterReport }>()
  for (const attempt of [state.first, state.second]) {
    for (const outcome of attempt?.outcomes ?? []) {
      const report = attempt?.reports.find(candidate => candidate.character === outcome.character) ?? playerReport(state, outcome)
      if (report !== undefined) decided.set(outcome.character, { outcome, report })
    }
  }
  return decided
}
