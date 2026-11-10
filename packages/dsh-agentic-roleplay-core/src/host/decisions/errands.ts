import type { DecisionService } from '@dsh-ai-providers/core'
import type { ErrandKeeper, TurnStore } from '../orchestration/boundaries.ts'
import { askExtra, noteExtra } from './extras.ts'

/** At most this many characters are asked about in one request, and the narration is cut to this many characters. */
const MAX_ASKED = 6
const NARRATION_CHARS = 1500
const PROMPT = 'roleplay/decide-errand'

/** The characters a turn's words name that could be kept: awake, not the player's, and not already off their day. */
function named(store: TurnStore, turn: number, text: string): { id: number; key: string; name: string }[] {
  const lower = text.toLowerCase()
  return store.cast().flatMap((member) => {
    const { character } = member
    if (character.control === 'player' || character.kind !== 'person' || store.asleep(turn, character.id) !== undefined) return []
    if (store.agenda(turn, character.id).offDay !== undefined) return []
    const mentioned = [character.name, ...character.aliases ?? []].some(name => name.trim() !== '' && lower.includes(name.toLowerCase()))
    return mentioned ? [{ id: character.id, key: member.key, name: character.name }] : []
  }).slice(0, MAX_ASKED)
}

/**
 * After a turn, asks the decision model for each character the turn names whether the story told it, or it chose, to stay, wait or watch until the player's
 * character is with it again, and keeps those that did where they are. It is the harness's own look, so an errand given by the game master, by another
 * character or by the player is kept whoever gave it; the game master can also say so itself, with `waits_for_player` on an outcome.
 */
export function errandChecks(deps: { decisions?: () => DecisionService | undefined; problem?: (message: string) => void }): ErrandKeeper {
  const seen = new Map<string, string>()
  return {
    async keep(job, signal): Promise<number> {
      const { store } = job
      const settings = store.settings()
      if (settings.decisions.errands === 'off' || !settings.schedule.enabled || store.holdForPlayer === undefined) return 0
      const narration = job.narration.slice(0, NARRATION_CHARS)
      const candidates = named(store, job.turn, [job.input, narration, ...job.deeds].join('\n'))
      if (candidates.length === 0) return 0
      const asks = candidates.map(candidate => ({ key: candidate.key, instructions: store.text(PROMPT, { name: candidate.name }) }))
      const { found, report } = await askExtra(deps.decisions?.(), { player_message: job.input, what_happened: job.deeds, what_the_player_read: narration }, asks, settings.decisions.gateThreshold, signal)
      noteExtra('errands', job.chat, store, report, seen, deps.problem)
      for (const key of found) store.holdForPlayer(candidates.find(candidate => candidate.key === key)!.id)
      return found.length
    },
  }
}
