/** A check suite is made of kits; a person asks for kits with a command and an assistant with a tool. */
export const KITS = ['consistency', 'fidelity', 'quality', 'playability'] as const
export type KitId = (typeof KITS)[number]

export const SEVERITIES = ['error', 'warning', 'info'] as const
export type Severity = (typeof SEVERITIES)[number]

/** `code` is decided by the program, `judged` by a model reading evidence the program gathered, `decision` is a yes-or-no a decision model may settle. */
export type CheckMode = 'code' | 'judged' | 'decision'

/** What a check needs besides the world: the card the world came from or is being updated from, and a model to judge. */
export type Need = 'card' | 'model'

export interface Finding {
  check: string
  severity: Severity
  /** Stable name of the kind of finding, for filtering. */
  code: string
  /** The file or part of the world it is about. */
  where: string
  message: string
  /** What would fix it, when that is clear. */
  hint?: string
}

export interface CheckSkipped {
  check: string
  reason: string
}

export interface CheckChanges {
  /** Findings that were not there the last time the check ran. */
  added: number
  /** Findings of the last run that are gone. */
  resolved: Finding[]
}

export interface CheckReport {
  at: string
  kits: KitId[]
  ran: string[]
  skipped: CheckSkipped[]
  findings: Finding[]
  /** Against the last stored result of the checks that ran now; absent the first time. */
  changes?: CheckChanges
}

/** The commands of an authoring chat that start checks, and the kits each runs. */
export const CHECK_COMMANDS: Readonly<Record<string, readonly KitId[]>> = {
  check: KITS,
  'check-all': KITS,
  'check-world': ['consistency'],
  'check-card': ['fidelity'],
  'check-quality': ['quality'],
  'check-play': ['playability'],
}

export const findingKey = (finding: Finding): string => `${finding.check}\n${finding.code}\n${finding.where}\n${finding.message}`
