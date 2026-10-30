import type { DecisionService, NoulAnswer } from '@dsh-ai-providers/core'
import type { DecisionMode, SiteReport } from '../../shared/decisions.ts'
import { MAX_SAMPLES } from '../../shared/decisions.ts'

/** The probability from which a yes is taken as a yes, for the confidence a chat asks. */
export const yesAt = (confidence: number): number => (1 + confidence) / 2

/** The probability up to which a no is taken as a no. */
export const noAt = (confidence: number): number => (1 - confidence) / 2

const clip = (text: string): string => (text.length > 120 ? `${text.slice(0, 119)}…` : text)

/** One site's judgements to give: each key is one yes-or-no question about the story. */
export interface Route<Key> {
  mode: DecisionMode
  /** From this probability a yes counts as a yes. */
  yesAt: number
  /** Up to this probability a no counts as a no; between the two is not sure. */
  noAt: number
  turn: number
  keys: readonly Key[]
  /** What a key stands for, in a few words, for the record of disagreements. */
  what: (key: Key) => string
  /** The decision model's probability of yes for each key. @throws when it cannot be used. */
  probabilities: (keys: readonly Key[]) => Promise<Map<Key, number>>
  /** The language model's verdict for each key. */
  llm: (keys: readonly Key[]) => Promise<Map<Key, boolean>>
}

export interface Routed<Key> {
  verdicts: Map<Key, boolean>
  report: SiteReport
}

const reportOf = (mode: DecisionMode, items: number): SiteReport => ({ mode, items, decided: 0, escalated: 0, fallbacks: 0, agreed: 0, disagreed: 0, decisionMs: 0, llmMs: 0, samples: [] })

async function timed<Result>(run: () => Promise<Result>): Promise<{ value: Result; ms: number }> {
  const started = performance.now()
  const value = await run()
  return { value, ms: Math.round(performance.now() - started) }
}

/**
 * Gives each key a verdict the way its site is set to: from the language model, from the decision model, from the decision model where it
 * is confident and the language model elsewhere, or from the language model while comparing it with the decision model. A decision model
 * that cannot be used never stops a story: its keys go to the language model and the report says why.
 */
export async function routeVerdicts<Key>(route: Route<Key>, signal: AbortSignal): Promise<Routed<Key>> {
  const { mode, keys } = route
  const report = reportOf(mode, keys.length)
  const verdicts = new Map<Key, boolean>()
  if (keys.length === 0) return { verdicts, report }

  const viaLlm = async (subset: readonly Key[]): Promise<void> => {
    const { value, ms } = await timed(() => route.llm(subset))
    report.llmMs += ms
    for (const [key, verdict] of value) verdicts.set(key, verdict)
  }
  const viaDecision = async (): Promise<Map<Key, number> | undefined> => {
    try {
      const { value, ms } = await timed(() => route.probabilities(keys))
      report.decisionMs += ms
      return value
    } catch (error) {
      if (signal.aborted) throw error
      report.problem = error instanceof Error ? error.message : String(error)
      return undefined
    }
  }

  if (mode === 'llm') {
    await viaLlm(keys)
    return { verdicts, report }
  }

  if (mode === 'shadow') {
    const [decided] = await Promise.all([viaDecision(), viaLlm(keys)])
    if (decided === undefined) return { verdicts, report }
    for (const key of keys) {
      const probability = decided.get(key)
      const llm = verdicts.get(key)
      if (probability === undefined || llm === undefined) continue
      const decision = probability >= route.yesAt
      if (decision === llm) report.agreed += 1
      else {
        report.disagreed += 1
        if (report.samples.length < MAX_SAMPLES) report.samples.push({ turn: route.turn, what: clip(route.what(key)), probability: Math.round(probability * 1000) / 1000, decision, llm })
      }
    }
    return { verdicts, report }
  }

  const decided = await viaDecision()
  if (decided === undefined) {
    report.fallbacks = keys.length
    await viaLlm(keys)
    return { verdicts, report }
  }
  const unsure: Key[] = []
  for (const key of keys) {
    const probability = decided.get(key)
    if (probability === undefined) { unsure.push(key); continue }
    if (mode === 'hybrid' && probability > route.noAt && probability < route.yesAt) unsure.push(key)
    else verdicts.set(key, probability >= route.yesAt)
  }
  report.decided = keys.length - unsure.length
  report.escalated = unsure.length
  if (unsure.length > 0) await viaLlm(unsure)
  return { verdicts, report }
}

/** `hybrid` is a default that only does something where a decision model is set up: with none it is the language model alone, and nothing is said, because nothing is wrong. */
export const modeFor = (mode: DecisionMode, service: unknown): DecisionMode => (mode === 'hybrid' && service === undefined ? 'llm' : mode)

/** Asks the decision model one yes-or-no question for each key about one state, in a single request; the answers are probabilities of yes. */
export async function askYesNo(service: DecisionService, state: Record<string, unknown>, asks: readonly { key: string; instructions: string }[], signal: AbortSignal): Promise<Map<string, number>> {
  const questions = Object.fromEntries(asks.map(({ key, instructions }) => [key, { type: 'noul' as const, instructions }]))
  const { answers } = await service.decide(state, questions, { priority: 'background', signal })
  return new Map(asks.map(({ key }) => [key, (answers as Record<string, NoulAnswer>)[key]!.probability]))
}

/**
 * Says once, through `say`, why a site's decision model could not be used, and again only when the reason changes, so that a story
 * played on without the service does not fill the log.
 */
export function announceProblem(seen: Map<string, string>, key: string, report: SiteReport, say: ((message: string) => void) | undefined): void {
  if (report.problem === undefined) { seen.delete(key); return }
  if (seen.get(key) === report.problem) return
  seen.set(key, report.problem)
  say?.(`the decision model could not be used for ${key}, the language model judged instead: ${report.problem}`)
}

/** The reports of several routed runs of one site as one: counts and times added, the disagreements kept up to the limit, the latest problem. */
export function mergeReports(mode: DecisionMode, reports: readonly SiteReport[]): SiteReport {
  const merged = reportOf(mode, 0)
  for (const report of reports) {
    merged.items += report.items
    merged.decided += report.decided
    merged.escalated += report.escalated
    merged.fallbacks += report.fallbacks
    merged.agreed += report.agreed
    merged.disagreed += report.disagreed
    merged.decisionMs += report.decisionMs
    merged.llmMs += report.llmMs
    merged.samples.push(...report.samples)
    if (report.problem !== undefined) merged.problem = report.problem
  }
  merged.samples = merged.samples.slice(-MAX_SAMPLES)
  return merged
}
