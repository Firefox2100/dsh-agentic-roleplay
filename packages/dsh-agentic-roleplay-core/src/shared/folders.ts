export const FOLDER_ACCESS = ['read', 'write'] as const
export type FolderAccess = (typeof FOLDER_ACCESS)[number]

/** A folder of the computer that one story has given its file tools. */
export interface StoryFolder {
  path: string
  access: FolderAccess
}

/** What the file tools of a story reach: the workspace every story shares, and the folders this story was given. */
export interface FoldersStatus {
  workspace: string
  folders: StoryFolder[]
  limit: number
}

/** The most folders one story may be given. */
export const MAX_STORY_FOLDERS = 16
/** The folder of the roleplay root that every story's file tools reach, whatever else it was given. */
export const WORKSPACE_FOLDER = 'workspace'
