import type { DecisionService } from '@dsh-ai-providers/core'
import type { CharacterId } from 'dsh-roleplay-model'
import type { ExtraSite, SiteReport } from '../../shared/decisions.ts'
import type { RuleCheck, Secret, TurnStore } from '../orchestration/boundaries.ts'
import { announceProblem, askYesNo } from './route.ts'

/** The most hidden facts one output is checked against, and how much of each the decision model is shown. */
export const MAX_SECRETS = 16
const SECRET_CHARS = 300

/**
 * The lore a character does not know: what is listed for others only and has no knowledge edge to them. A fact whose title the passage names is
 * asked about first, so that a crowded world is cut where it matters least.
 */
export function hiddenFrom(story: TurnStore['story'], character: CharacterId, passage: string): Secret[] {
  const text = passage.toLowerCase()
  const hidden = story.lore.list().filter(entry => entry.scope === 'listed' && entry.summary.trim() !== '' && !story.knowledge.knows(character, 'lore', entry.id))
  const named = (title: string): boolean => text.includes(title.toLowerCase())
  return [...hidden.filter(entry => named(entry.title)), ...hidden.filter(entry => !named(entry.title))].slice(0, MAX_SECRETS).map(entry => ({ title: entry.title, text: entry.summary.trim().slice(0, SECRET_CHARS) }))
}

/** What a decision model that only adds a check has to report: one request, no language model to compare with. */
const reportOf = (items: number, ms: number, problem?: string): SiteReport => ({ mode: 'decision', items, decided: problem === undefined ? items : 0, escalated: 0, fallbacks: 0, agreed: 0, disagreed: 0, decisionMs: ms, llmMs: 0, samples: [], ...problem === undefined ? {} : { problem } })

/**
 * Asks the decision model one yes-or-no question for each key in a request of its own and says which keys came back at or above the threshold.
 * A check that cannot be made is not a verdict: the report says why, and nothing is found.
 */
export async function askExtra(service: DecisionService | undefined, state: Record<string, unknown>, asks: readonly { key: string; instructions: string }[], threshold: number, signal: AbortSignal): Promise<{ found: string[]; report: SiteReport }> {
  const started = performance.now()
  try {
    if (service === undefined) throw new Error('no decision service is selected, or the selected one is not loaded')
    const answers = await askYesNo(service, state, asks, signal)
    return { found: asks.filter(ask => (answers.get(ask.key) ?? 0) >= threshold).map(ask => ask.key), report: reportOf(asks.length, Math.round(performance.now() - started)) }
  } catch (error) {
    if (signal.aborted) throw error
    return { found: [], report: reportOf(asks.length, Math.round(performance.now() - started), error instanceof Error ? error.message : String(error)) }
  }
}

/** Says once that an extra site could not be checked, and keeps the run in the story's figures. */
export function noteExtra(site: ExtraSite, chat: string, store: TurnStore, report: SiteReport, seen: Map<string, string>, say: ((message: string) => void) | undefined): void {
  announceProblem(seen, `${chat}:${site}`, report, say === undefined ? undefined : message => { say(message.replace('the language model judged instead', 'nothing was checked')) })
  store.recordDecisions?.(site, report)
}

const RULE_PROMPT = 'roleplay/check-rule'

/**
 * Checks the player's action against every rule of the world and of the player in one request of the decision model, one question for each rule, when the chat
 * has `decisions.rules` on. It is only ever asked after the game master has judged the action allowed: a rule that holds there is found for the game master to look at again.
 */
export function ruleChecks(deps: { decisions?: () => DecisionService | undefined; problem?: (message: string) => void }): RuleCheck {
  const seen = new Map<string, string>()
  return {
    async check(job, signal): Promise<string[]> {
      const settings = job.store.settings()
      const rules = job.store.rules()
      if (settings.decisions.rules === 'off' || rules.length === 0 || job.input.trim() === '') return []
      const asks = rules.map((rule, index) => ({ key: `rule${index}`, instructions: job.store.text(RULE_PROMPT, { rule }) }))
      const { found, report } = await askExtra(deps.decisions?.(), { player_character: job.player, player_message: job.input }, asks, settings.decisions.gateThreshold, signal)
      noteExtra('rules', job.chat, job.store, report, seen, deps.problem)
      return found.map(key => rules[Number(key.slice('rule'.length))]!)
    },
  }
}
