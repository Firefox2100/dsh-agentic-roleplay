import { classifyEntries, readLorebook } from '../../src/host/import/lorebook.ts'
import { extractStyleFrom } from '../../src/host/import/extract.ts'
import { readPreset } from '../../src/host/import/preset.ts'
import type { ImportContext } from '../../src/host/import/run.ts'
import type { LibraryCase, LibraryOutcome } from './library-cases.ts'

/** Imports a preset or a lorebook file the way the library importers do, with the given model context, and says what came out. */
export async function importLibraryFile(made: LibraryCase, ctx: ImportContext): Promise<LibraryOutcome & { notes: string[] }> {
  if (made.kind.startsWith('preset')) {
    const preset = readPreset(made.file, `${made.name}.json`)
    const style = await extractStyleFrom(ctx, preset.name, preset.pieces)
    return { prompts: style.prompts, rules: style.rules, entries: [], steering: [], notes: style.notes }
  }
  const classified = await classifyEntries(ctx, readLorebook(made.file, `${made.name}.json`))
  return { prompts: [], rules: [], entries: classified.entries, steering: Object.values(classified.steering).flat(), notes: classified.notes }
}
