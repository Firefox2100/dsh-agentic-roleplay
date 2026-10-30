import { mkdir, rename } from 'node:fs/promises'
import { basename, join, relative } from 'node:path'
import { InvalidEditProblems } from '../../shared/world-state.ts'
import { WorldNotFoundError } from '../sessions/errors.ts'
import type { WorldCatalog } from '../worlds/catalog.ts'
import { checkWorld, type WorldCheck } from '../worlds/world-check.ts'
import { isDraftWorld } from '../worlds/draft.ts'
import { keepDraft, settleDraft } from './run-import.ts'
import { resumeImport, type StartImportDeps, type StartedImport } from './start-import.ts'

/** What the person is told about a draft: whether the world is one, and what is wrong with it now. A draft that has been mended is an ordinary world again. */
export interface DraftStatus {
  draft: boolean
  check?: WorldCheck
}

export type DraftAction = 'ask' | 'keep' | 'discard'

async function draftOf(worlds: WorldCatalog, worldId: string): Promise<NonNullable<Awaited<ReturnType<WorldCatalog['find']>>>> {
  const record = await worlds.find(worldId)
  if (record === undefined) throw new WorldNotFoundError(`there is no world with id "${worldId}"`)
  return record
}

export async function draftStatus(worlds: WorldCatalog, worldId: string): Promise<DraftStatus> {
  const record = await draftOf(worlds, worldId)
  if (!await isDraftWorld(record.directory)) return { draft: false }
  if (await settleDraft(record.directory)) { await worlds.list({ refresh: true }); return { draft: false } }
  return { draft: true, check: await checkWorld({ directory: record.directory, summary: record.summary, ...(record.variables === undefined ? {} : { variables: record.variables }) }) }
}

/**
 * What the person decides about a draft: have the assistant try again (with the card at hand), keep it as it is (an ordinary world that cannot be played until it is mended),
 * or discard it (the folder goes to the root's trash, where it can still be found).
 * @throws {InvalidEditProblems} when the world is not a draft.
 */
export async function actOnDraft(deps: Pick<StartImportDeps, 'worlds' | 'authoring'> & { root: () => string }, worldId: string, action: DraftAction, language?: string): Promise<{ action: DraftAction; started?: StartedImport; keptIn?: string }> {
  const record = await draftOf(deps.worlds, worldId)
  if (!await isDraftWorld(record.directory)) throw new InvalidEditProblems(['this world is not a draft'])
  if (action === 'ask') return { action, started: await resumeImport(deps, worldId, language) }
  if (action === 'keep') { await keepDraft(record.directory); await deps.worlds.list({ refresh: true }); return { action } }
  const trash = join(deps.root(), '.trash', 'worlds')
  await mkdir(trash, { recursive: true })
  const destination = join(trash, `${basename(record.directory)}-${Date.now()}`)
  await rename(record.directory, destination)
  await deps.worlds.list({ refresh: true })
  return { action, keptIn: relative(deps.root(), destination) }
}
