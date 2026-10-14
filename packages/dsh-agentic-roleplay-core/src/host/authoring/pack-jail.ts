import { extname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type { PreToolDecision, ToolExecution } from '@deepseek-ai/dsh-tools'
import { PACKS_FOLDER } from '../../shared/interface-pack.ts'
import { authoredWorldOf } from '../../shared/authoring-chat.ts'
import { isPackId } from '../interface/pack.ts'
import { TEXT_EXTENSIONS } from '../interface/world-packs.ts'

/** DSH's own file tools, which the world authoring chat uses on the interface packs and nothing else. */
export const PACK_FILE_TOOLS = ['read', 'write', 'edit'] as const
const WRITING: readonly string[] = ['write', 'edit']

/** The most text a call may carry. */
export const MAX_PACK_TEXT = 200 * 1024

/**
 * Why a call of a file tool is not one on an interface pack of the world, or nothing when it is: the file must be a text
 * file of a pack folder `<world>/ui/<pack>/`, and a write must not carry more text than a pack file may hold.
 * @param path - the absolute path asked for.
 * @param world - the world's folder.
 */
export function packFileProblem(tool: string, path: string, world: string, texts: readonly string[] = []): string | undefined {
  const ui = join(world, PACKS_FOLDER)
  const inside = relative(ui, path)
  const segments = inside.split(sep)
  const hint = `in this chat the file tools reach only the text files of the world's interface packs, ${join(ui, '<pack>', '<file>')}. Nothing, not another path and not sandbox_permissions, lifts that: do not try again for this file, tell the person that it cannot be changed from here`
  if (inside === '' || inside.startsWith('..') || isAbsolute(inside) || segments.length < 2) return `${path} is not a file of an interface pack: ${hint}`
  if (!isPackId(segments[0] as string)) return `"${segments[0]}" is not a usable pack name (letters, digits, "-" and "_"): ${hint}`
  if (segments.some(segment => segment.startsWith('.'))) return `${path}: names may not start with a dot`
  if (!TEXT_EXTENSIONS.includes(extname(path).slice(1).toLowerCase())) return `${path} is not a text file of a pack (${TEXT_EXTENSIONS.join(', ')}); pictures and other files are added by hand`
  if (WRITING.includes(tool) && texts.some(text => Buffer.byteLength(text) > MAX_PACK_TEXT)) return `a call may carry at most ${MAX_PACK_TEXT / 1024} KB of text`
  return undefined
}

export interface PackJailDeps {
  /** The folder of the world an authoring chat is about. */
  worldDirectory(chat: string): Promise<string | undefined>
  /** Whether the chat is in the turn that reviews an import, which leaves the packs alone. */
  reviewing(chat: string): Promise<boolean>
}

const textOf = (value: unknown): string[] => (typeof value === 'string' ? [value] : [])

/**
 * Keeps DSH's `read`, `write` and `edit` on the interface packs of the world in an authoring chat, and asks the person before
 * any change. It stands first in the chain, so that what it refuses cannot be let through by a listener after it; and what a
 * later listener decides still stands: a plugin that denies or asks keeps doing so, and only a plain allow becomes an ask.
 */
export async function packJail(exec: ToolExecution, next: () => Promise<PreToolDecision>, deps: PackJailDeps): Promise<PreToolDecision> {
  const chat = exec.agent?.session.id
  if (!(PACK_FILE_TOOLS as readonly string[]).includes(exec.name) || chat === undefined || authoredWorldOf(chat) === undefined) return await next()
  const world = await deps.worldDirectory(chat)
  if (world === undefined) return { kind: 'deny', reason: 'the world of this chat no longer exists' }
  const args = exec.arguments as Record<string, unknown>
  const requested = args['file_path']
  if (typeof requested !== 'string' || requested === '' || requested.startsWith('~')) return { kind: 'deny', reason: 'file_path must be a path of an interface pack of this world' }
  const path = resolve(exec.agent?.session.header.cwd ?? world, requested)
  const problem = packFileProblem(exec.name, path, world, [...textOf(args['content']), ...textOf(args['new_string'])])
  if (problem !== undefined) return { kind: 'deny', reason: problem }
  const writing = WRITING.includes(exec.name)
  if (writing && await deps.reviewing(chat)) return { kind: 'deny', reason: 'an import does not write interface packs; they are left to the person' }
  const decision = await next()
  if (!writing || decision.kind !== 'allow') return decision
  const target = `“${relative(join(world, PACKS_FOLDER), path)}”`
  return {
    kind: 'ask',
    reason: `${exec.name} interface pack file ${target}`,
    displayReason: { en: `${exec.name === 'write' ? 'Write' : 'Edit'} ${target} of an interface pack in the world files?`, zh: `${exec.name === 'write' ? '写入' : '编辑'}世界文件中界面包的文件${target}？` },
  }
}

/** Puts the jail first in the chain of `tools/pre-execute`: what it refuses cannot be let through by a listener after it. */
export function registerPackJail(ctx: Context, deps: PackJailDeps): void {
  ctx.on('tools/pre-execute', (exec, next) => packJail(exec, next, deps), { prepend: true })
}
