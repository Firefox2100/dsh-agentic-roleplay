import { describeValue, locationKey as placeKey, type ItemEffect } from '@dsh-agentic-roleplay/state'
import type { TriggerReport, TurnStore } from './boundaries.ts'
import type { Utterance } from './protocol.ts'
import { sameWords } from './defaults.ts'
import { decisions } from './turn-rules.ts'
import type { TurnState } from './turn-state.ts'
import type { ResolveReport, TurnOwner } from './turn-engine.ts'

/** Records the game master's decisions as a finished round: what the characters did and said, what changed in the story, and the round queued for the keeper. `fire` runs the triggers the round may have made true. */
export function recordRound(store: TurnStore, owner: TurnOwner, state: TurnState, fire: (round: number) => TriggerReport['fired']): NonNullable<ResolveReport['done']> {
  const decided = decisions(state)
  const limit = store.settings().maxRounds
  const round = state.rounds + 1
  const checked = new Map([...decided.values()].flatMap(({ outcome }) => (outcome.moveTo === undefined ? [] : [[outcome.character, store.checkMove(outcome.character, outcome.moveTo)] as const])))
  const refused = [...checked].flatMap(([character, check]) => (check.ok ? [] : [`${character}: ${check.problems.join('; ')}`]))
  if (refused.length > 0) throw new Error(`a move is no longer possible: ${refused.join('; ')}`)
  const spoken = [...decided.values()].flatMap(({ outcome, report }): Utterance[] =>
    report.utterance === undefined || outcome.spoken === false || state.utterances.some(said => said.character === report.character && sameWords(said.text, report.utterance!)) ? [] : [{ character: report.character, name: report.name, text: report.utterance, round }])
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
  const updates = [...decided.values()].flatMap(({ outcome, report }) => {
    const member = state.cast.find(candidate => candidate.key === report.character)
    if (member === undefined) return []
    const check = checked.get(outcome.character)
    return [{
      key: report.character,
      update: {
        character: member.character.id,
        patch: { activity: outcome.summary, ...(outcome.publicState === undefined || outcome.publicState.trim() === '' ? {} : { publicState: outcome.publicState.trim() }) },
        ...(check?.ok === true ? { move: check.move } : {}),
        ...(outcome.itemChanges === undefined || outcome.itemChanges.length === 0 ? {} : { items: outcome.itemChanges }),
      },
    }]
  })
  const effects = new Map<string, ItemEffect[]>()
  const done = store.commit(updates.map(entry => entry.update))
  updates.forEach(({ key }, index) => { effects.set(key, done[index] ?? []) })
  const tracked = new Map(updates.map(({ key }) => [key, store.changeVariables(owner.turn, decided.get(key)?.outcome.variableChanges ?? []).map(effect => ({ subject: effect.subjectName, name: effect.variable.name, from: describeValue(effect.variable, effect.from), to: describeValue(effect.variable, effect.to) }))]))
  const journey = [...checked].flatMap(([character, check]) => (check.ok && state.cast.find(candidate => candidate.key === character)?.character.control === 'player' ? [check.plan.travelSeconds ?? 0] : []))[0]
  const time = store.endRound(owner.turn, round, state.elapsed, journey)
  delete state.elapsed
  const world = fire(round)
  const loose = store.story.dice.rolls({ turn: owner.turn }).filter(roll => !state.cited.has(roll.id) && !state.reported.has(roll.id))
  for (const roll of loose) state.reported.add(roll.id)
  store.queueCommit({
    turn: owner.turn, round, situation: state.situation,
    ...(loose.length === 0 ? {} : { rolls: loose.map(roll => `${roll.reason}: ${roll.expression} came to ${roll.total}${roll.readout === undefined ? '' : `: ${roll.readout.label}${roll.readout.critical ? ' (critical)' : ''} (${roll.readout.result})`}${roll.by === 'player' ? ' (rolled by the player)' : ''}`) }),
    ...(playerPlace === undefined ? {} : { place: { key: placeKey(playerPlace), name: playerPlace.name } }),
    time: { from: time.from, to: time.to, zone: time.zone },
    entries: [...decided.values()].map(({ outcome, report }) => {
      const at = state.cast.find(candidate => candidate.key === report.character)?.place?.location
      const check = checked.get(outcome.character)
      return {
        character: report.character, name: report.name, intent: report.intent, commitment: report.commitment,
        ...(report.utterance === undefined ? {} : { utterance: report.utterance }),
        result: outcome.result, summary: outcome.summary,
        ...(outcome.publicState === undefined || outcome.publicState.trim() === '' ? {} : { publicState: outcome.publicState.trim() }),
        spoken: outcome.spoken !== false,
        ...((tracked.get(report.character) ?? []).length === 0 ? {} : { variables: tracked.get(report.character)! }),
        ...(state.cast.find(candidate => candidate.key === report.character)?.character.control === 'player' ? { player: true as const } : {}),
        ...(report.forced === true ? { forced: true as const } : {}),
        ...((effects.get(report.character) ?? []).length === 0 ? {} : { items: (effects.get(report.character) ?? []).map(effect => ({ name: effect.item.name, action: effect.action, summary: effect.summary })) }),
        ...(at === undefined ? {} : { at: { key: placeKey(at), name: at.name } }),
        ...(check?.ok === true && check.plan.from !== check.move.to ? { moved: { ...check.to, ...(check.position === undefined ? {} : { position: check.position }) } } : {}),
      }
    }),
  })
  return { round, limit, updated: [...decided.keys()], retryFailures: state.second?.failures ?? [], utterances: spoken, spoken: [...state.utterances], waiting: store.pendingCommits().length, variables: [...tracked.values()].flat().map(change => `${change.subject}'s ${change.name} is now ${change.to} (it was ${change.from})`), time: { from: time.from, to: time.to, zone: time.zone }, moved: time.moved, world, things: [...effects].flatMap(([character, list]) => list.map(effect => ({ character, name: effect.item.name, action: effect.action, summary: effect.summary }))), moves: [...checked].flatMap(([character, check]) => (check.ok && check.plan.from !== check.move.to ? [{ character, name: decided.get(character)?.report.name ?? character, to: check.to.name, via: Math.max(0, check.plan.via.length - 1) }] : [])) }
}
