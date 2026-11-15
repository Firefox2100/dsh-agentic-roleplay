import type { StoryComparison } from '../../shared/compare.ts'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-chat/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import { NARRATION_NODE, PREVIEW_NODE, chatNarration, chatPreview, type NarrationNodeData, type PreviewNodeData } from './definitions.ts'
import { PreviewNode } from './PreviewNode.tsx'
import { branchAt } from './branching.ts'
import { facadeOf } from '../chat-input.ts'
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

/** The turns of a roleplay session, as the host keeps them. */
async function timelineOf(chat: string): Promise<TimelineView | undefined> {
  const id = roleplaySessionOf(chat)
  if (id === undefined) throw new Error('this chat is not a roleplay session')
  const response = await fetch(`roleplay-api/sessions/timeline?id=${encodeURIComponent(id)}`)
  // Ordinary DSH chats use the same id shape. A missing roleplay session means this dock does not own the chat.
  if (response.status === 404) return undefined
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

/** Names a turn as a checkpoint (an empty name takes it off). */
async function markTurn(chat: string, turn: string, label: string, note?: string): Promise<void> {
  const id = roleplaySessionOf(chat)
  if (id === undefined) throw new Error('this chat is not a roleplay session')
  const response = await fetch(`roleplay-api/sessions/timeline/checkpoint?id=${encodeURIComponent(id)}&turn=${encodeURIComponent(turn)}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ label, ...(note === undefined ? {} : { note }) }) })
  if (!response.ok) throw new Error(((await response.json().catch(() => ({}))) as { message?: string }).message ?? `the checkpoint could not be made (${response.status})`)
}

/** What differs between the story now and the state after a turn. */
async function compareWith(chat: string, turn: string): Promise<StoryComparison> {
  const id = roleplaySessionOf(chat)
  if (id === undefined) throw new Error('this chat is not a roleplay session')
  const response = await fetch(`roleplay-api/sessions/compare?id=${encodeURIComponent(id)}&a=${encodeURIComponent(turn)}&b=head`)
  if (!response.ok) throw new Error(((await response.json().catch(() => ({}))) as { message?: string }).message ?? `the states could not be compared (${response.status})`)
  return await response.json() as StoryComparison
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
      inject: (sessionId: string) => ({ timeline: () => timelineOf(sessionId), move: (to: string) => moveTo(sessionId, to), mark: (turn: string, label: string, note?: string) => markTurn(sessionId, turn, label, note), compare: (turn: string) => compareWith(sessionId, turn), fill: facadeOf(scope, sessionId).fill, branch: (atSeq: number) => branchAt(scope, sessionId, atSeq) }),
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
      inject: (sessionId: string) => ({ sessionId }),
    }, narrationNode(t)))
  })
}
