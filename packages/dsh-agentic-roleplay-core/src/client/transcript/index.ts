import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-chat/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import { NARRATION_NODE, PREVIEW_NODE, chatNarration, chatPreview, type NarrationNodeData, type PreviewNodeData } from './definitions.ts'
import { PreviewNode } from './PreviewNode.tsx'
import { narrationNode } from './NarrationNode.tsx'
import { SuggestionsDock } from './SuggestionsDock.tsx'
import { roleplaySessionOf } from '../../shared/chat.ts'
import type { Note } from '../../shared/notes.ts'
import { dictionaries, type TranscriptLocaleKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    'roleplay.transcript': TranscriptLocaleKey
  }
}

declare module '@deepseek-ai/dsh-client-ui-chat/client' {
  interface ChatNodeDataMap {
    'roleplay-narration': NarrationNodeData
    'roleplay-preview': PreviewNodeData
  }
}

const NAMESPACE = 'roleplay.transcript'

/** The slice of the session service and the conversation service used to write into the input box. */
interface SessionsLike {
  scope(sessionId: string): ScopeLike | undefined
}
interface ScopeLike {
  get(name: 'conversation'): { input: { for(actx: unknown): { setDraft(text: string): void } } } | undefined
}

/** Puts a text into the input box of a session. */
function inputOf(scope: { get(name: 'sessions'): unknown }, sessionId: string): (text: string) => void {
  return (text) => {
    const actx = (scope.get('sessions') as SessionsLike | undefined)?.scope(sessionId)
    const conversation = actx?.get('conversation')
    if (actx === undefined || conversation === undefined) throw new Error('the input of this chat is not available')
    conversation.input.for(actx).setDraft(text)
  }
}

/** The notes the host keeps for the player beside the story; none for a chat that is not a roleplay session. */
async function notesOf(chat: string): Promise<Note[]> {
  const id = roleplaySessionOf(chat)
  if (id === undefined) return []
  const response = await fetch(`roleplay-api/sessions/notes?id=${encodeURIComponent(id)}`)
  if (!response.ok) throw new Error(`the notes could not be read (${response.status})`)
  return await response.json() as Note[]
}

/**
 * Shows the output of a roleplay turn in the normal Chat. It needs the
 * conversation UI, so it is added only once that exists.
 */
export function registerTranscript(ctx: Context): void {
  const t = ctx.locale.bind(NAMESPACE)
  ctx.effect(() => ctx.locale.register(NAMESPACE, dictionaries), 'roleplay: transcript dictionaries')

  ctx.inject(['uiConversation'], (scope) => {
    // The session's input is the conversation service's; it is resolved on use, so a client without it fails at the click.
    scope.slots.inject('conversation.input.dock', () => scope.slots.register({
      name: 'conversation.input.dock',
      id: 'roleplay-suggestions',
      order: 10,
      locale: NAMESPACE,
      inject: (sessionId: string) => ({ pick: inputOf(scope, sessionId), notes: () => notesOf(sessionId) }),
    }, SuggestionsDock))
    scope.uiConversation.events.register(chatNarration)
    scope.uiConversation.events.register(chatPreview)
    scope.slots.inject('conversation.chat.node', () => scope.slots.register({
      name: 'conversation.chat.node',
      key: PREVIEW_NODE,
    }, PreviewNode))
    scope.slots.inject('conversation.chat.node', () => scope.slots.register({
      name: 'conversation.chat.node',
      key: NARRATION_NODE,
    }, narrationNode(t)))
  })
}
