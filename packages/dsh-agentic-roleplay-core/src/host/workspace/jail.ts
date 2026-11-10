import { readdirSync, realpathSync, statSync } from 'node:fs'
import { dirname, isAbsolute, resolve } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type { PreToolDecision, ToolExecution } from '@deepseek-ai/dsh-tools'
import { roleplaySessionOf } from '../../shared/chat.ts'
import { isInside } from './folders.ts'

/** DSH's file tools whose path is a `file_path` argument, and those that search under a `path`. */
const FILE_TOOLS = ['read', 'read_image', 'write', 'edit'] as const
const SEARCH_TOOLS = ['glob', 'grep'] as const
const WRITING: readonly string[] = ['write', 'edit']
const PATCHING = 'apply_patch'
const PATCH_FILES = /^\*\*\* (?:Add|Update|Delete) File: (.+)$|^\*\*\* Move to: (.+)$/gmu

export interface FolderRoot {
  path: string
  write: boolean
}

export interface FoldersJailDeps {
  /** What the file tools of a story's agents may reach, or nothing for a chat that is not a story. */
  roots(session: string): Promise<FolderRoot[] | undefined>
  /** Where each is told its workspace is, for the refusals. */
  workspace(): string
}

/** The real path of a file that may not exist yet: the nearest folder above it that does, followed through links, with the rest put back. */
export function realPathOf(path: string): string {
  const rest: string[] = []
  let current = resolve(path)
  for (;;) {
    try {
      return rest.reduceRight((made, part) => resolve(made, part), realpathSync(current))
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT' && (error as NodeJS.ErrnoException).code !== 'ENOTDIR') throw error
      const up = dirname(current)
      if (up === current) return resolve(path)
      rest.push(current.slice(up.length + 1))
      current = up
    }
  }
}

const MOST_LISTED = 30

/** Where a model that tried to read a folder is sent: what the folder holds. A bare "not a regular file" made helpers try the same folder twenty times. */
export function folderListing(path: string): string | undefined {
  try {
    if (!statSync(path).isDirectory()) return undefined
    const names = readdirSync(path, { withFileTypes: true }).map(entry => (entry.isDirectory() ? `${entry.name}/` : entry.name)).sort()
    const shown = names.slice(0, MOST_LISTED).join(', ')
    return `${path} is a folder, not a file, so it cannot be read. It holds: ${names.length === 0 ? 'nothing' : shown}${names.length > MOST_LISTED ? ` and ${names.length - MOST_LISTED} more` : ''}. Read one of those files by its whole path (${path}/<name>)`
  } catch { return undefined }
}

/** Why a path is out of reach for a story, or nothing when it is inside a folder the story may use (and may write, when it writes). */
export function folderProblem(path: string, writing: boolean, roots: readonly FolderRoot[], workspace: string): string | undefined {
  if (!isAbsolute(path)) return `give the whole path (it is not relative to anything the tools know): the story's workspace is ${workspace}`
  const real = realPathOf(path)
  const found = roots.filter(root => isInside(root.path, real))
  if (found.length === 0) return `${path} is outside the folders this story's tools may use: its workspace ${workspace}${roots.length > 1 ? ` and ${roots.filter(root => root.path !== workspace).map(root => `${root.path} (${root.write ? 'read and write' : 'read only'})`).join(', ')}` : ''}. Nothing, not another path and not sandbox_permissions, lifts that: tell the person if it is needed`
  if (writing && !found.some(root => root.write)) return `${path} is in a folder this story may only read: tell the person if it should be changed`
  return undefined
}

function patchPaths(patch: string): string[] {
  return [...patch.matchAll(PATCH_FILES)].map(match => (match[1] ?? match[2] ?? '').trim()).filter(path => path !== '')
}

/**
 * Keeps DSH's file tools of a story's agents (the game master and its helpers) inside the story's workspace and the folders the person gave the story.
 * It stands first in the chain, so that what it refuses cannot be let through by a listener after it. Shell and terminal tools are not held to folders:
 * they stay off unless the person turns them on.
 */
export async function foldersJail(exec: ToolExecution, next: () => Promise<PreToolDecision>, deps: FoldersJailDeps): Promise<PreToolDecision> {
  const header = exec.agent?.session.header
  const chat = header?.origin === 'subagent' ? header.parentSession : exec.agent?.session.id
  const session = chat === undefined ? undefined : roleplaySessionOf(chat)
  if (session === undefined) return await next()
  const files = (FILE_TOOLS as readonly string[]).includes(exec.name)
  const search = (SEARCH_TOOLS as readonly string[]).includes(exec.name)
  if (!files && !search && exec.name !== PATCHING) return await next()
  const roots = await deps.roots(session)
  if (roots === undefined) return await next()
  const args = exec.arguments as Record<string, unknown>
  const check = (paths: readonly unknown[], writing: boolean): PreToolDecision | undefined => {
    for (const path of paths) {
      if (typeof path !== 'string' || path === '' || path.startsWith('~')) return { kind: 'deny', reason: `the path must be a whole path inside the story's workspace ${deps.workspace()} or a folder it was given` }
      const problem = folderProblem(path, writing, roots, deps.workspace())
      if (problem !== undefined) return { kind: 'deny', reason: problem }
    }
    return undefined
  }
  if (files) {
    const refused = check([args['file_path']], WRITING.includes(exec.name))
    if (refused !== undefined) return refused
    const listing = exec.name === 'read' || exec.name === 'read_image' ? folderListing(args['file_path'] as string) : undefined
    return listing === undefined ? await next() : { kind: 'deny', reason: listing }
  }
  if (search) return check([args['path'] ?? deps.workspace()], false) ?? await next()
  const patch = args['patch'] ?? args['input']
  const paths = typeof patch === 'string' ? patchPaths(patch) : []
  if (paths.length === 0) return { kind: 'deny', reason: 'apply_patch must name its files: write them as whole paths inside the story\'s folders' }
  return check(paths, true) ?? await next()
}

/** Puts the jail first in the chain of `tools/pre-execute`. */
export function registerFoldersJail(ctx: Context, deps: FoldersJailDeps): void {
  ctx.on('tools/pre-execute', (exec, next) => foldersJail(exec, next, deps), { prepend: true })
}
