import { createRequire } from 'node:module'

/**
 * Where the sqlite-vec extension is, or why it cannot be used here. The package carries a
 * prebuilt binary for each platform it supports; elsewhere there is none, and a session works
 * without vector search.
 */
export function vectorExtension(): { path: string } | { error: string } {
  try {
    const { getLoadablePath } = createRequire(import.meta.url)('sqlite-vec') as { getLoadablePath(): string }
    return { path: getLoadablePath() }
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) }
  }
}
