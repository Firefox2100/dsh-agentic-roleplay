import type { CheckMode, Finding, KitId, Need } from '../../shared/checks.ts'
import type { CheckedWorld } from '../worlds/validated-world.ts'
import type { ImportContext } from '../import/run.ts'
import type { CardEvidence } from './card-evidence.ts'

/** What a check is given. The card and the judge are there only when the run has them; a check that needs one is skipped without it. */
export interface CheckInput {
  world: CheckedWorld
  card?: CardEvidence
  /** What a judged check asks a model with: the import's own runner, so the chat's model, the import settings and the decision model apply. */
  model?: ImportContext
  /** What the checks of one run have already read of the world, so the parts several checks look at are read and parsed once; `runChecks` sets it. */
  memo?: Map<string, Promise<unknown>>
}

export interface Check {
  id: string
  kit: KitId
  mode: CheckMode
  needs: readonly Need[]
  description: string
  run(input: CheckInput): Promise<Finding[]>
}

/** Thrown by a check that cannot run on this world; the report says why instead of counting it as clean. */
export class CheckSkipped extends Error {}

export type Found = Omit<Finding, 'check'>

/** A check's findings with the check's id on each. */
export const foundBy = (check: string, found: readonly Found[]): Finding[] => found.map(finding => ({ ...finding, check }))
