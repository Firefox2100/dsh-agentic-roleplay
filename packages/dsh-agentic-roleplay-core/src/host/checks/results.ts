import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { findingKey, type CheckChanges, type Finding } from '../../shared/checks.ts'
import { atomicWrite } from '../atomic-write.ts'

/** Where a world keeps what its checks found: a dot folder, so what is published leaves it out, like the import's. */
export const CHECKS_FOLDER = '.checks'
const FILE = 'results.json'

interface Stored {
  version: 1
  checks: Record<string, { at: string; findings: Finding[] }>
}

async function read(directory: string): Promise<Stored> {
  try {
    const stored = JSON.parse(await readFile(join(directory, CHECKS_FOLDER, FILE), 'utf8')) as Stored
    return stored.version === 1 && typeof stored.checks === 'object' && stored.checks !== null ? stored : { version: 1, checks: {} }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT' || error instanceof SyntaxError) return { version: 1, checks: {} }
    throw error
  }
}

/**
 * Stores the findings of the checks that ran, replacing their last ones, and says what changed against those: results of checks that did not run stay.
 * @returns `undefined` when none of these checks had run before.
 */
export async function recordResults(directory: string, at: string, results: Record<string, Finding[]>): Promise<CheckChanges | undefined> {
  const stored = await read(directory)
  const before = Object.keys(results).flatMap(id => stored.checks[id]?.findings ?? [])
  const known = Object.keys(results).some(id => stored.checks[id] !== undefined)
  const now = Object.values(results).flat()
  const was = new Set(before.map(findingKey))
  const is = new Set(now.map(findingKey))
  for (const [id, findings] of Object.entries(results)) stored.checks[id] = { at, findings }
  await atomicWrite(join(directory, CHECKS_FOLDER, FILE), JSON.stringify(stored, null, 2), { createDirectory: true })
  return known ? { added: now.filter(finding => !was.has(findingKey(finding))).length, resolved: before.filter(finding => !is.has(findingKey(finding))) } : undefined
}
