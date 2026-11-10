import { translator, type Language } from 'dsh-roleplay-model'
import type { FolderRoot } from './jail.ts'

/** What an agent with file tools is told of where they reach: the shared workspace first, then the folders given to this story. Nothing for a story with no workspace. */
export function foldersLine(roots: readonly FolderRoot[], language: Language): string | undefined {
  const [workspace, ...rest] = roots
  if (workspace === undefined) return undefined
  const tr = translator(language)
  const given = rest.map(folder => (folder.write ? tr('{path} (read and write)', { path: folder.path }) : tr('{path} (read only)', { path: folder.path })))
  return tr('Your file tools reach only these folders, and every path must be a whole path. The shared workspace, which you may read and write: {workspace}.{given}', { workspace: workspace.path, given: given.length === 0 ? '' : tr(' Given for this story: {folders}.', { folders: given.join(tr(', ')) }) })
}
