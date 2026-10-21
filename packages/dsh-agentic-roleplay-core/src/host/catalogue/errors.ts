import type { ConflictReason } from '../../shared/catalogue.ts'

/** What went wrong with a catalogue request, by who is at fault: the request, the catalogue, or what is already there. */
export type CatalogueFailure = 'input' | 'unknown' | 'upstream' | 'invalid' | 'conflict' | 'unavailable'

export class CatalogueError extends Error {
  constructor(message: string, readonly failure: CatalogueFailure, readonly detail?: { reason: ConflictReason; changes?: string[] }) {
    super(message)
  }
}
