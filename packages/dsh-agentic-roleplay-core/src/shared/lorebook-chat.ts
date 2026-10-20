const PREFIX = 'lorebook-author-'

/** Stable DSH chat identity for the authoring conversation of one library lorebook. */
export function lorebookChatSessionId(name: string): string {
  if (name === '') throw new TypeError('lorebook name cannot be empty')
  return `${PREFIX}${encodeURIComponent(name)}`
}

/** The library lorebook named by a dedicated lorebook authoring chat. */
export function lorebookOfChat(chatSessionId: string): string | undefined {
  if (!chatSessionId.startsWith(PREFIX)) return undefined
  try {
    const name = decodeURIComponent(chatSessionId.slice(PREFIX.length))
    return name === '' ? undefined : name
  } catch {
    return undefined
  }
}
