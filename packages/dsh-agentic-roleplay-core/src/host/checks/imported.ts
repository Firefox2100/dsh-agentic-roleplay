import { KITS } from '../../shared/checks.ts'
import { loadCardEvidence } from './card-evidence.ts'
import { runChecks } from './run.ts'
import { presentReport } from './present.ts'

/**
 * What every import and update is checked with when it is written: all the checks the program decides, against the card the world now comes from, stored with the world. The
 * checks a model judges are not run here: the assistant that reviews the import asks for them (`deep`) when the card and these findings call for it.
 * @returns what the assistant reads of the report.
 */
export async function checkImported(directory: string, name: string): Promise<object> {
  const card = await loadCardEvidence(directory, 'current')
  return presentReport(await runChecks({ world: { directory, summary: { name } }, ...(card === undefined ? {} : { card }) }, { kits: KITS }))
}
