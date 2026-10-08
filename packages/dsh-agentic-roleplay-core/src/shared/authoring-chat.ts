const PREFIX = 'world-author-'

/** Stable DSH chat identity for the authoring conversation of one world. */
export function authoringChatSessionId(worldId: string): string {
  if (worldId === '') throw new TypeError('world id cannot be empty')
  return `${PREFIX}${encodeURIComponent(worldId)}`
}

/** The authored world named by a dedicated authoring chat. */
export function authoredWorldOf(chatSessionId: string): string | undefined {
  if (!chatSessionId.startsWith(PREFIX)) return undefined
  try {
    const id = decodeURIComponent(chatSessionId.slice(PREFIX.length))
    return id === '' ? undefined : id
  } catch {
    return undefined
  }
}
