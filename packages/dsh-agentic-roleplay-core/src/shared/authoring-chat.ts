const PREFIX = 'world-author-'

/**
 * `@` is never produced by `encodeURIComponent`, so it can mark which conversation of a world a chat is without being taken for a part of the world's id.
 * The first conversation has no mark, so that the chats of earlier versions keep their ids.
 */
const GENERATION = /@(\d+)$/

/**
 * DSH chat identity of the authoring conversation of one world. A deleted conversation leaves its agent loaded in DSH under its id until DSH restarts, so the next one of the
 * world is a new generation with an id of its own.
 */
export function authoringChatSessionId(worldId: string, generation = 1): string {
  if (worldId === '') throw new TypeError('world id cannot be empty')
  if (!Number.isInteger(generation) || generation < 1) throw new TypeError('generation must be a whole number from 1')
  return `${PREFIX}${encodeURIComponent(worldId)}${generation === 1 ? '' : `@${generation}`}`
}

/** The authored world named by a dedicated authoring chat, whichever conversation of it that is. */
export function authoredWorldOf(chatSessionId: string): string | undefined {
  if (!chatSessionId.startsWith(PREFIX)) return undefined
  try {
    const id = decodeURIComponent(chatSessionId.slice(PREFIX.length).replace(GENERATION, ''))
    return id === '' ? undefined : id
  } catch {
    return undefined
  }
}
