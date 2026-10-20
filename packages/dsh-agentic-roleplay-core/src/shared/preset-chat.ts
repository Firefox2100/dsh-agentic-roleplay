const PREFIX = 'preset-author-'

/** Stable DSH chat identity for the authoring conversation of one library preset. */
export function presetChatSessionId(name: string): string {
  if (name === '') throw new TypeError('preset name cannot be empty')
  return `${PREFIX}${encodeURIComponent(name)}`
}

/** The library preset named by a dedicated preset authoring chat. */
export function presetOfChat(chatSessionId: string): string | undefined {
  if (!chatSessionId.startsWith(PREFIX)) return undefined
  try {
    const name = decodeURIComponent(chatSessionId.slice(PREFIX.length))
    return name === '' ? undefined : name
  } catch {
    return undefined
  }
}
