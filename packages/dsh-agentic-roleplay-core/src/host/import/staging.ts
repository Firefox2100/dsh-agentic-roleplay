import { randomUUID } from 'node:crypto'
import type { SelectionChoice, SelectionKind, SelectionPreview } from '../../shared/import-selection.ts'
import { previewLorebook, selectEntries } from './lorebook.ts'
import { previewPreset, selectPrompts } from './preset.ts'
import { ImportNotFoundError } from './store.ts'

interface Staged { kind: SelectionKind; file: Buffer; name: string; at: number }

const KEEP_MS = 60 * 60 * 1000
const MAX_STAGED = 12

/**
 * Files waiting for the person to choose what of them is imported: a preset's prompts, a lorebook's entries. They are kept in memory for an hour, not on disk:
 * nothing is made of a file until the choice is made, and a restart only asks the person to upload it again.
 */
export class ImportStaging {
  private readonly staged = new Map<string, Staged>()

  /** @throws {ImportCardError} when the file is not of the kind. */
  stage(kind: SelectionKind, file: Buffer, name: string): SelectionPreview {
    const preview = kind === 'preset' ? previewPreset(file, name) : { ...previewLorebook(file, name), sampling: undefined }
    this.forget()
    const id = randomUUID()
    this.staged.set(id, { kind, file, name, at: Date.now() })
    while (this.staged.size > MAX_STAGED) this.staged.delete(this.staged.keys().next().value as string)
    const ignored = 'ignored' in preview ? preview.ignored : {}
    return { id, kind, name: preview.name, items: preview.items, ...(Object.keys(ignored).length === 0 ? {} : { ignored }), ...(preview.sampling === undefined || Object.keys(preview.sampling).length === 0 ? {} : { sampling: preview.sampling }) }
  }

  /** The staged file with only what the choice names, and the name it was staged under; the staged file stays until it is discarded. @throws {ImportNotFoundError} when there is none. @throws {ImportCardError} when the choice cannot be used. */
  choose(kind: SelectionKind, choice: SelectionChoice): { file: Buffer; name: string } {
    this.forget()
    const found = this.staged.get(choice.id)
    if (found === undefined || found.kind !== kind) throw new ImportNotFoundError('the file is no longer waiting: upload it again')
    return { file: kind === 'preset' ? selectPrompts(found.file, choice.enabled, choice.sampling) : selectEntries(found.file, choice.enabled, found.name), name: found.name }
  }

  discard(id: string): void {
    this.staged.delete(id)
  }

  private forget(): void {
    const limit = Date.now() - KEEP_MS
    for (const [id, entry] of this.staged) if (entry.at < limit) this.staged.delete(id)
  }
}

/** Reads the choice of a request body. @throws {ImportCardError} through the caller's validation when it is not one. */
export function parseSelectionChoice(body: unknown): SelectionChoice | string {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return 'the choice must be an object'
  const { id, enabled, sampling } = body as Record<string, unknown>
  if (typeof id !== 'string' || id === '') return '"id" must name the staged file'
  if (!Array.isArray(enabled) || !enabled.every(entry => typeof entry === 'string')) return '"enabled" must be a list of text'
  if (sampling !== undefined && typeof sampling !== 'boolean') return '"sampling" must be true or false'
  return { id, enabled: enabled as string[], sampling: sampling !== false }
}
