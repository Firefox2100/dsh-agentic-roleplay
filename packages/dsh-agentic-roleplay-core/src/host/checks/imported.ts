import { KITS } from '../../shared/checks.ts'
import type { ImportContext } from '../import/run.ts'
import { loadCardEvidence } from './card-evidence.ts'
import { runChecks } from './run.ts'
import { presentReport } from './present.ts'

/**
 * What every import and update is checked with when it is written: all the checks the program decides, against the card the world now comes from, stored with the world. The
 * checks a model judges are not run here: the assistant that reviews the import asks for them (`deep`) when the card and these findings call for it. The exception is the
 * yes-or-no checks, which run when the import has a decision model to answer them.
 * @returns what the assistant reads of the report.
 */
export async function checkImported(directory: string, name: string, model?: ImportContext): Promise<object> {
  const card = await loadCardEvidence(directory, 'current')
  const deciding = model?.decide !== undefined
  return presentReport(await runChecks({ world: { directory, summary: { name } }, ...(card === undefined ? {} : { card }), ...(deciding ? { model } : {}) }, { kits: KITS, ...(deciding ? { deep: 'decision' as const } : {}) }))
}
