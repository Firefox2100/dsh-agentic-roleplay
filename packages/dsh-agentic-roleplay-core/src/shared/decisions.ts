/** The places where a language model's closed-choice judgement can be given to a decision model instead, or, for the gates, a check can be made at all. */
export const DECISION_SITES = ['triggers', 'reflection', 'agency', 'refusal', 'rules', 'secrets'] as const
export type DecisionSite = (typeof DECISION_SITES)[number]

/** The sites that check what the game master delivers to the player. They are off unless a chat turns one on: a check costs a request, or at least a call, in every turn. */
export const GATE_SITES = ['agency', 'refusal'] as const satisfies readonly DecisionSite[]
export type GateSite = (typeof GATE_SITES)[number]

/**
 * The sites only a decision model serves: a check the harness did not have before. They are off unless a chat turns one on, and then cost one more
 * call of the decision model in the turn; off, the story plays as it did without them.
 */
export const EXTRA_SITES = ['rules', 'secrets'] as const satisfies readonly DecisionSite[]
export type ExtraSite = (typeof EXTRA_SITES)[number]
export const EXTRA_MODES = ['off', 'on'] as const
export type ExtraMode = (typeof EXTRA_MODES)[number]

/**
 * Who makes a site's judgements.
 * - `llm`: the language model, as before.
 * - `decision`: the decision model alone; a judgement it is not confident of counts as "no".
 * - `hybrid`: the decision model where it is confident, the language model for the rest.
 * - `shadow`: both, acting on the language model's answer and recording whether the decision model agreed.
 */
export const DECISION_MODES = ['llm', 'decision', 'hybrid', 'shadow'] as const
export type DecisionMode = (typeof DECISION_MODES)[number]

/** What a gate can be set to: the modes of any site, or off. */
export const GATE_MODES = ['off', ...DECISION_MODES] as const
export type GateMode = (typeof GATE_MODES)[number]

/** How the judgements of one site went, as one run of it reports them. */
export interface SiteReport {
  /** What the site was set to for this run. */
  mode: DecisionMode
  /** The judgements the run was asked for. */
  items: number
  /** Taken from the decision model. */
  decided: number
  /** Handed to the language model because the decision model was not confident (`hybrid`). */
  escalated: number
  /** Handed to the language model because the decision model could not be used. */
  fallbacks: number
  /** Compared in `shadow` mode: the decision model said what the language model said. */
  agreed: number
  /** Compared in `shadow` mode: it said something else. */
  disagreed: number
  /** Time the decision model took, in milliseconds; 0 when it was not asked. */
  decisionMs: number
  /** Time the language model took, in milliseconds; 0 when it was not asked. */
  llmMs: number
  /** Why the decision model could not be used, when it could not. */
  problem?: string
  /** Where the two disagreed, for tuning. */
  samples: DecisionSample[]
}

export interface DecisionSample {
  turn: number
  /** What was judged, shortened. */
  what: string
  /** The decision model's probability that the answer is yes. */
  probability: number
  /** What it made of that with the chat's confidence. */
  decision: boolean
  /** What the language model said. */
  llm: boolean
}

export interface SiteStats {
  runs: number
  items: number
  decided: number
  escalated: number
  fallbacks: number
  agreed: number
  disagreed: number
  decisionMs: number
  llmMs: number
  /** The latest disagreements, newest last. */
  samples: DecisionSample[]
  /** The latest reason the decision model could not be used. */
  problem?: string
}

/** What was kept about the decisions of one story; it lives beside the database, so taking the story back does not change it. */
export interface DecisionStats {
  since: string
  sites: Record<DecisionSite, SiteStats>
}

/** `GET /roleplay-api/sessions/decisions`. */
export interface DecisionsPayload {
  /** Whether a decision service is on the host now. */
  available: boolean
  provider?: string
  model?: string
  stats: DecisionStats
}

export const MAX_SAMPLES = 20

export const emptySiteStats = (): SiteStats => ({ runs: 0, items: 0, decided: 0, escalated: 0, fallbacks: 0, agreed: 0, disagreed: 0, decisionMs: 0, llmMs: 0, samples: [] })

export const emptyStats = (since: string): DecisionStats => ({ since, sites: Object.fromEntries(DECISION_SITES.map(site => [site, emptySiteStats()])) as Record<DecisionSite, SiteStats> })
