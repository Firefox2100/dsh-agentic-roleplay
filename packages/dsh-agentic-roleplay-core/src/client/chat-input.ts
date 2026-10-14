/** The slice of the session service and the conversation service used to write into the input box. */
interface SessionsLike {
  scope(sessionId: string): ScopeLike | undefined
}
interface ScopeLike {
  get(name: 'conversation'): { input: { for(actx: unknown): { setDraft(text: string): void; submit(): void } } } | undefined
}

/** What can be done with the input box of a session: put words in it, and send them. Resolved on use, so a client without it fails at the click. */
export function facadeOf(scope: { get(name: 'sessions'): unknown }, sessionId: string): { pick: (text: string) => void; fill: (text: string, send: boolean) => void } {
  const input = (): { setDraft(text: string): void; submit(): void } => {
    const actx = (scope.get('sessions') as SessionsLike | undefined)?.scope(sessionId)
    const conversation = actx?.get('conversation')
    if (actx === undefined || conversation === undefined) throw new Error('the input of this chat is not available')
    return conversation.input.for(actx)
  }
  return {
    pick: (text) => { input().setDraft(text) },
    fill: (text, send) => { const facade = input(); facade.setDraft(text); if (send) facade.submit() },
  }
}

