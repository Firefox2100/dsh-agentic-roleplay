import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { PreToolDecision, ToolExecution } from '@deepseek-ai/dsh-tools'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { chatSessionId } from '../../../src/shared/chat.ts'
import { folderProblem, foldersJail, type FolderRoot } from '../../../src/host/workspace/jail.ts'

let base: string
let workspace: string
let notes: string
let roots: FolderRoot[]
const SESSION = '3b3f0c62-1d2f-4c52-8f1a-5c0e8d1b9a77'

beforeEach(async () => {
  base = await mkdtemp(join(tmpdir(), 'jail-'))
  workspace = join(base, 'workspace')
  notes = join(base, 'notes')
  await mkdir(workspace, { recursive: true })
  await mkdir(notes, { recursive: true })
  roots = [{ path: workspace, write: true }, { path: notes, write: false }]
})
afterEach(async () => { await rm(base, { recursive: true, force: true }) })

const run = async (name: string, args: Record<string, unknown>, options: { chat?: string; child?: boolean; known?: boolean } = {}): Promise<PreToolDecision> => {
  const chat = options.chat ?? chatSessionId(SESSION)
  const header = options.child === true ? { origin: 'subagent', parentSession: chat } : { origin: 'user' }
  const exec = { name, arguments: args, agent: { session: { id: options.child === true ? 'child-1' : chat, header } } } as unknown as ToolExecution
  return await foldersJail(exec, () => Promise.resolve({ kind: 'allow' } as PreToolDecision), { roots: () => Promise.resolve(options.known === false ? undefined : roots), workspace: () => workspace })
}

describe('the folders a story\'s file tools may reach', () => {
  it('lets a file in the workspace or a given folder be read, and only the writable ones be written', async () => {
    expect((await run('read', { file_path: join(workspace, 'a.txt') })).kind).toBe('allow')
    expect((await run('write', { file_path: join(workspace, 'new', 'a.txt'), content: 'x' })).kind).toBe('allow')
    expect((await run('read', { file_path: join(notes, 'n.txt') })).kind).toBe('allow')
    expect(await run('write', { file_path: join(notes, 'n.txt'), content: 'x' })).toMatchObject({ kind: 'deny', reason: expect.stringContaining('only read') })
  })

  it('answers a read of a folder with what the folder holds, so that the same read is not tried again', async () => {
    await writeFile(join(notes, 'brief.md'), 'x')
    await mkdir(join(notes, 'assets'))
    const decision = await run('read', { file_path: notes })
    expect(decision).toMatchObject({ kind: 'deny', reason: expect.stringContaining('assets/, brief.md') })
    expect((await run('read', { file_path: join(notes, 'brief.md') })).kind).toBe('allow')
    expect((await run('glob', { path: notes })).kind).toBe('allow')
  })

  it('refuses another folder, a relative path, a home path and a way out through a link or "..", whatever the tool', async () => {
    await symlink(base, join(workspace, 'out'))
    for (const path of [join(base, 'other.txt'), 'a.txt', '~/a.txt', join(workspace, 'out', 'other.txt'), join(workspace, '..', 'other.txt')]) expect((await run('read', { file_path: path })).kind, path).toBe('deny')
    expect((await run('glob', { pattern: '*', path: base })).kind).toBe('deny')
    expect((await run('grep', { pattern: 'x', path: join(notes, '..') })).kind).toBe('deny')
    expect((await run('glob', { pattern: '*' })).kind).toBe('allow')
  })

  it('holds a patch to the files it names, and refuses one that names none', async () => {
    const patch = (file: string) => `*** Begin Patch\n*** Add File: ${file}\n+hi\n*** End Patch`
    expect((await run('apply_patch', { input: patch(join(workspace, 'p.txt')) })).kind).toBe('allow')
    expect((await run('apply_patch', { input: patch(join(notes, 'p.txt')) })).kind).toBe('deny')
    expect((await run('apply_patch', { input: patch('relative.txt') })).kind).toBe('deny')
    expect((await run('apply_patch', { input: 'nothing' })).kind).toBe('deny')
  })

  it('applies to the helpers of the story and leaves everything else alone', async () => {
    expect((await run('read', { file_path: join(base, 'x') }, { child: true })).kind).toBe('deny')
    expect((await run('read', { file_path: join(base, 'x') }, { chat: 'session-not-a-story' })).kind).toBe('allow')
    expect((await run('bash', { command: 'ls /' })).kind).toBe('allow')
    expect((await run('read', { file_path: join(base, 'x') }, { known: false })).kind).toBe('allow')
  })

  it('says where the workspace is when it refuses', () => {
    expect(folderProblem(join(base, 'x'), false, roots, workspace)).toContain(workspace)
  })
})
