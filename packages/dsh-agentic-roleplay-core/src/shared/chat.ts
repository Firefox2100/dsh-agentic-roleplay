const CHAT_PREFIX = 'session-'
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

/** The DSH chat of a roleplay session is named after the session's id. */
export function chatSessionId(sessionId: string): string {
  return `${CHAT_PREFIX}${sessionId}`
}

/** The roleplay session a DSH chat id could belong to; ordinary DSH chats have ids of the same shape. */
export function roleplaySessionOf(chat: string): string | undefined {
  if (!chat.startsWith(CHAT_PREFIX)) return undefined
  const id = chat.slice(CHAT_PREFIX.length)
  return UUID_V4.test(id) ? id : undefined
}
