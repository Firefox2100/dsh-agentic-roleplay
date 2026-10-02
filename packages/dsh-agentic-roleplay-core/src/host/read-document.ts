import { readFile, stat } from 'node:fs/promises'
import type { WorldProblem } from '../shared/worlds.ts'
import { formatIssue, type ParseResult } from './validation.ts'

/** Authored documents are short; a larger file is not one. */
const MAX_DOCUMENT_BYTES = 1024 * 1024

/**
 * Read and parse one authored document. Every problem is added to `problems`
 * with the file's path, and the document is skipped.
 */
export async function readDocument<T>(
  file: string,
  parse: (text: string) => ParseResult<T>,
  problems: WorldProblem[],
): Promise<T | undefined> {
  if ((await stat(file)).size > MAX_DOCUMENT_BYTES) {
    problems.push({ path: file, message: 'file is too large' })
    return undefined
  }
  const result = parse(await readFile(file, 'utf8'))
  if (result.ok) return result.value
  for (const issue of result.issues) problems.push({ path: file, message: formatIssue(issue) })
  return undefined
}
