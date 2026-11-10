import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { MAX_STORY_FOLDERS, type FoldersStatus, type StoryFolder } from '../../shared/folders.ts'
import { checkFolders, readFolders, workspaceOf, writeFolders } from './folders.ts'
import type { FolderRoot } from './jail.ts'

/** What the file tools of a story reach: the shared workspace, always writable, and each folder the story was given. */
export async function storyRoots(root: string, sessionFolder: string): Promise<FolderRoot[]> {
  const workspace = workspaceOf(root)
  await mkdir(workspace, { recursive: true })
  const given = await readFolders(sessionFolder)
  const folders = await checkFolders(given, root).catch((): StoryFolder[] => [])
  return [{ path: workspace, write: true }, ...folders.map(folder => ({ path: folder.path, write: folder.access === 'write' }))]
}

export interface FoldersDeps {
  root(): string
  /** The folder of a story's files; refuses an id that names no story. */
  sessionFolder(id: string): string
}

/** The folders of one story, for the page that shows and changes them. */
export class StoryFoldersService {
  constructor(private readonly deps: FoldersDeps) {}

  async status(id: string): Promise<FoldersStatus> {
    const folder = this.deps.sessionFolder(id)
    const workspace = workspaceOf(this.deps.root())
    await mkdir(workspace, { recursive: true })
    return { workspace, folders: await readFolders(folder), limit: MAX_STORY_FOLDERS }
  }

  async set(id: string, folders: readonly StoryFolder[]): Promise<FoldersStatus> {
    const folder = this.deps.sessionFolder(id)
    await writeFolders(folder, folders, this.deps.root())
    return await this.status(id)
  }
}

export const sessionFolderPath = (sessionsDir: string, id: string): string => join(sessionsDir, id)
