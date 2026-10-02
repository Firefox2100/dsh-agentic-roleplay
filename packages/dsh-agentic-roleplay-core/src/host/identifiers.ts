import type { Reader } from './validation.ts'

export const MAX_ID_LENGTH = 100

/**
 * Read an `id` field. Ids are opaque strings, unique within their scope, that
 * stay the same when the file is copied or edited.
 * @param fallback - used when the file sets none.
 */
export function readIdentifier(reader: Reader, fallback?: string): string | undefined {
  const id = reader.string('id') ?? fallback
  if (id !== undefined && id.length > MAX_ID_LENGTH) reader.fail('id', `must be at most ${MAX_ID_LENGTH} characters`)
  return id
}
