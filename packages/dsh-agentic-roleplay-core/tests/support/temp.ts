import { rm } from 'node:fs/promises'

/**
 * Removes a temporary story folder, closing the session connections that hold its SQLite files first.
 * Windows refuses to delete an open database (`EBUSY`), and a test keeps its `RoleplayState` alive past the test.
 */
export async function removeTemp(root: string, ...states: Array<{ closeAll(): void } | undefined>): Promise<void> {
  for (const state of states) state?.closeAll()
  await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 })
}
