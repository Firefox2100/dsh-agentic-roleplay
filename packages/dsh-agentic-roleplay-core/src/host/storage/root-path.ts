import { mkdir } from 'node:fs/promises'
import { homedir } from 'node:os'
import { isAbsolute, join, normalize } from 'node:path'

/** Directories every roleplay root contains. */
export const ROOT_LAYOUT = ['characters', 'sessions', 'worlds'] as const

/**
 * Resolve the configured root to an absolute, normalized path.
 * @param raw - configured value; a leading `~` stands for the home directory.
 * @param home - home directory used for `~` expansion.
 * @returns the absolute root path.
 * @throws {Error} when the value is blank or does not resolve to an absolute path.
 */
export function resolveRootPath(raw: string, home: string = homedir()): string {
  const value = raw.trim()
  if (value === '') throw new Error('roleplay root path is empty')
  const expanded = value === '~' ? home : value.startsWith('~/') ? join(home, value.slice(2)) : value
  if (!isAbsolute(expanded)) throw new Error(`roleplay root path must be absolute or start with "~": ${raw}`)
  return normalize(expanded)
}

/**
 * Create the root and its baseline directories; existing ones are left as they are.
 * @param root - absolute root path.
 */
export async function ensureRootLayout(root: string): Promise<void> {
  await mkdir(root, { recursive: true })
  await Promise.all(ROOT_LAYOUT.map(name => mkdir(join(root, name), { recursive: true })))
}
