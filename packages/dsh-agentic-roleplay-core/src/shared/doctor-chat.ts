const PREFIX = 'doctor-'
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

/** Stable DSH chat identity for the session doctor of one roleplay session. */
export function doctorChatSessionId(sessionId: string): string {
  return `${PREFIX}${sessionId}`
}

/** The roleplay session a session doctor chat looks after. */
export function doctorSessionOf(chat: string): string | undefined {
  if (!chat.startsWith(PREFIX)) return undefined
  const id = chat.slice(PREFIX.length)
  return UUID_V4.test(id) ? id : undefined
}
