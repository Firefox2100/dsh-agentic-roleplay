import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-chat/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import { NARRATION_NODE, PREVIEW_NODE, chatNarration, chatPreview, type NarrationNodeData, type PreviewNodeData } from './definitions.ts'
import { PreviewNode } from './PreviewNode.tsx'
import { narrationNode } from './NarrationNode.tsx'
import { SuggestionsDock } from './SuggestionsDock.tsx'
import { TurnsDock } from './TurnsDock.tsx'
import type { TimelineView } from '../../shared/timeline.ts'
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
  get(name: 'conversation'): { input: { for(actx: unknown): { setDraft(text: string): void; submit(): void } } } | undefined
}

/** What can be done with the input box of a session: put words in it, and send them. Resolved on use, so a client without it fails at the click. */
function facadeOf(scope: { get(name: 'sessions'): unknown }, sessionId: string): { pick: (text: string) => void; fill: (text: string, send: boolean) => void } {
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

/** The turns of a roleplay session, as the host keeps them. */
async function timelineOf(chat: string): Promise<TimelineView> {
  const id = roleplaySessionOf(chat)
  if (id === undefined) throw new Error('this chat is not a roleplay session')
  const response = await fetch(`roleplay-api/sessions/timeline?id=${encodeURIComponent(id)}`)
  if (!response.ok) throw new Error(`the turns could not be read (${response.status})`)
  const view = await response.json() as Partial<TimelineView> & Pick<TimelineView, 'head' | 'path' | 'forward' | 'canStart'>
  return { ...view, withdrawn: view.withdrawn ?? [] }
}

/** Takes the story to a turn (or `start`); the host says what went wrong in its own words. */
async function moveTo(chat: string, to: string): Promise<{ draft?: string }> {
  const id = roleplaySessionOf(chat)
  if (id === undefined) throw new Error('this chat is not a roleplay session')
  const response = await fetch(`roleplay-api/sessions/timeline/move?id=${encodeURIComponent(id)}&to=${encodeURIComponent(to)}`, { method: 'POST' })
  if (!response.ok) throw new Error(((await response.json().catch(() => ({}))) as { message?: string }).message ?? `the story could not be taken there (${response.status})`)
  return await response.json() as { draft?: string }
}

/** The slice of the session service and the workspace used to branch a chat: DSH makes the chat, the host gives it its session. */
interface Branching {
  fork(options: { sessionId: string; atSeq: number; increaseTitle: boolean }): Promise<string>
}

/** Branches a roleplay chat after the turn that ended at `atSeq`, and shows the new chat. Resolved on use, so a client without the services fails at the click. */
async function branchAt(scope: { get(name: string): unknown }, chat: string, atSeq: number): Promise<void> {
  const sessions = scope.get('sessions') as Branching | undefined
  const workspace = scope.get('uiWorkspace') as { openSession(sessionId: string): void } | undefined
  if (sessions === undefined || workspace === undefined) throw new Error('branching is not available in this client')
  workspace.openSession(await sessions.fork({ sessionId: chat, atSeq, increaseTitle: true }))
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
      id: 'roleplay-turns',
      order: 5,
      locale: NAMESPACE,
      inject: (sessionId: string) => ({ timeline: () => timelineOf(sessionId), move: (to: string) => moveTo(sessionId, to), fill: facadeOf(scope, sessionId).fill, branch: (atSeq: number) => branchAt(scope, sessionId, atSeq) }),
    }, TurnsDock))
    scope.slots.inject('conversation.input.dock', () => scope.slots.register({
      name: 'conversation.input.dock',
      id: 'roleplay-suggestions',
      order: 10,
      locale: NAMESPACE,
      inject: (sessionId: string) => ({ pick: facadeOf(scope, sessionId).pick, notes: () => notesOf(sessionId) }),
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
