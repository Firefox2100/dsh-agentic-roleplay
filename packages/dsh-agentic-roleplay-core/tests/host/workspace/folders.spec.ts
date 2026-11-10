import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { MAX_STORY_FOLDERS } from '../../../src/shared/folders.ts'
import { checkFolders, InvalidFoldersError, readFolders, writeFolders } from '../../../src/host/workspace/folders.ts'
import { storyRoots } from '../../../src/host/workspace/service.ts'

let base: string
let root: string
let notes: string
let story: string

beforeEach(async () => {
  base = await mkdtemp(join(tmpdir(), 'folders-'))
  root = join(base, 'roleplay')
  notes = join(base, 'notes')
  story = join(root, 'sessions', 's1')
  await mkdir(join(root, 'workspace'), { recursive: true })
  await mkdir(notes, { recursive: true })
  await mkdir(story, { recursive: true })
})
afterEach(async () => { await rm(base, { recursive: true, force: true }) })

describe('the folders a story is given', () => {
  it('keeps real, existing folders once each, with the wider access when one is given twice', async () => {
    await symlink(notes, join(base, 'link'))
    const kept = await checkFolders([{ path: notes, access: 'read' }, { path: join(base, 'link'), access: 'write' }], root)
    expect(kept).toEqual([{ path: notes, access: 'write' }])
  })

  it('says every problem: not whole, missing, a file, the whole disk, too many', async () => {
    await writeFile(join(base, 'a-file'), 'x')
    await expect(checkFolders([{ path: 'notes', access: 'read' }, { path: join(base, 'nope'), access: 'read' }, { path: join(base, 'a-file'), access: 'read' }, { path: '/', access: 'read' }], root)).rejects.toMatchObject({ problems: [expect.stringContaining('whole path'), expect.stringContaining('does not exist'), expect.stringContaining('not a folder'), expect.stringContaining('whole disk')] })
    await expect(checkFolders(Array.from({ length: MAX_STORY_FOLDERS + 1 }, () => ({ path: notes, access: 'read' as const })), root)).rejects.toThrow(InvalidFoldersError)
  })

  it('refuses the roleplay root, what lies above it and what lies in it beside the workspace', async () => {
    await expect(checkFolders([{ path: root, access: 'read' }], root)).rejects.toThrow(/keeps every story/)
    await expect(checkFolders([{ path: base, access: 'read' }], root)).rejects.toThrow(/keeps every story/)
    await expect(checkFolders([{ path: join(root, 'sessions'), access: 'read' }], root)).rejects.toThrow(/keeps every story/)
    await mkdir(join(root, 'workspace', 'inner'))
    await expect(checkFolders([{ path: join(root, 'workspace', 'inner'), access: 'write' }], root)).resolves.toHaveLength(1)
  })

  it('writes and reads them back, and a story given none has none', async () => {
    expect(await readFolders(story)).toEqual([])
    await writeFolders(story, [{ path: notes, access: 'read' }], root)
    expect(await readFolders(story)).toEqual([{ path: notes, access: 'read' }])
    await expect(writeFolders(story, [{ path: join(base, 'nope'), access: 'read' }], root)).rejects.toThrow(InvalidFoldersError)
    expect(await readFolders(story)).toEqual([{ path: notes, access: 'read' }])
  })

  it('reaches the shared workspace always, and the given folders with their access; a folder that has gone is dropped', async () => {
    await writeFolders(story, [{ path: notes, access: 'read' }], root)
    expect(await storyRoots(root, story)).toEqual([{ path: join(root, 'workspace'), write: true }, { path: notes, write: false }])
    await rm(notes, { recursive: true })
    expect(await storyRoots(root, story)).toEqual([{ path: join(root, 'workspace'), write: true }])
  })
})
