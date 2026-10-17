import { locationKey as placeKey } from '@dsh-agentic-roleplay/state'
import type { OffSceneItem } from '../clock/offscene.ts'
import type { CastMember, TurnStore } from './boundaries.ts'
import type { CharacterReport } from './protocol.ts'
import type { Attempt, TurnState } from './turn-state.ts'
import type { TurnOwner } from './turn-engine.ts'

/** Rounds off stage are numbered from here, so that they never collide with the rounds the game master runs. */
export const OFFSTAGE_ROUND = 100

/** What the off-stage rounds need from the engine that runs them. */
export interface OffStageDeps {
  /** Asks the characters of a group what they do, in one attempt of a round only they take part in. */
  ask(group: readonly string[], cast: readonly CastMember[], asked: TurnState, summary: boolean): Promise<Attempt>
  write(): void
  /** Whether the turn is still the one the engine is working on. */
  stillThis(): boolean
}

/**
 * What the characters away from the player decide about what fell due, one commitment after another: their activity, and a move to where the commitment was when they
 * mean to keep it. It is recorded as a round only they perceive, and the keeper writes it.
 */
export async function runOffScene(deps: OffStageDeps, owner: TurnOwner, state: TurnState, store: TurnStore, due: readonly OffSceneItem[], limit: number): Promise<void> {
  const { summary, perCharacter, joint } = store.settings().offstage
  let budget = limit
  const acted = new Map<string, number>()
  for (const item of due) {
    if (budget <= 0) break
    const cast = store.cast()
    const keys = item.characters.filter(key => cast.some(member => member.key === key) && (acted.get(key) ?? 0) < perCharacter).slice(0, budget)
    if (keys.length === 0) continue
    budget -= keys.length
    for (const key of keys) acted.set(key, (acted.get(key) ?? 0) + 1)
    const reports: CharacterReport[] = []
    // The people of one commitment decide one after another, each told who has already meant to come, so that they meet instead of each guessing; the number of asks is the same.
    for (const group of joint ? keys.map(key => [key]) : [keys]) {
      const attending = reports.filter(report => report.commitment !== 'low').map(report => `${report.name} has decided: ${report.intent}${report.utterance === undefined ? '' : `, saying "${report.utterance}"`}.`)
      const asked: TurnState = { ...state, situation: attending.length === 0 ? item.text : `${item.text}\n${attending.join('\n')}`, history: [], recalled: new Map() }
      delete asked.first
      delete asked.second
      reports.push(...(await deps.ask(group, cast, asked, summary)).reports)
    }
    if (reports.length === 0) continue
    const where = item.place
    const moves = new Map(reports.flatMap((report) => {
      if (report.commitment === 'low' || where === undefined) return []
      const check = store.checkMove(report.character, { location: where, ignoreExits: true })
      return check.ok ? [[report.character, check] as const] : []
    }))
    store.commit(reports.flatMap((report) => {
      const member = cast.find(candidate => candidate.key === report.character)
      const move = moves.get(report.character)
      return member === undefined ? [] : [{ character: member.character.id, patch: { activity: report.intent }, ...(move?.ok === true ? { move: move.move } : {}) }]
    }))
    state.offstage += 1
    const time = store.time(owner.turn)
    store.queueCommit({
      turn: owner.turn, round: OFFSTAGE_ROUND + state.offstage, situation: item.text, offstage: true,
      time: { from: time.now, to: time.now, zone: time.zone },
      entries: reports.map((report) => {
        const at = cast.find(candidate => candidate.key === report.character)?.place?.location
        const move = moves.get(report.character)
        return {
          character: report.character, name: report.name, intent: report.intent, commitment: report.commitment, result: 'succeeded' as const, summary: report.intent, spoken: false,
          ...(at === undefined ? {} : { at: { key: placeKey(at), name: at.name } }),
          ...(move?.ok === true && move.plan.from !== move.move.to ? { moved: { ...move.to } } : {}),
        }
      }),
    })
    store.markHandled([item.key])
    deps.write()
    if (summary && deps.stillThis()) {
      const lines = reports.flatMap(report => (report.account === undefined ? [] : [report.account]))
      store.addNote('away', owner.turn, lines)
    }
  }
}
