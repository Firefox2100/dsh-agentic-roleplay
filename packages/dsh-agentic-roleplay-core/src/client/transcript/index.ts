import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-chat/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import { NARRATION_NODE, chatNarration, type NarrationNodeData } from './definitions.ts'
import { narrationNode } from './NarrationNode.tsx'
import { dictionaries, type TranscriptLocaleKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    'roleplay.transcript': TranscriptLocaleKey
  }
}

declare module '@deepseek-ai/dsh-client-ui-chat/client' {
  interface ChatNodeDataMap {
    'roleplay-narration': NarrationNodeData
  }
}

const NAMESPACE = 'roleplay.transcript'

/**
 * Shows the output of a roleplay turn in the normal Chat. It needs the
 * conversation UI, so it is added only once that exists.
 */
export function registerTranscript(ctx: Context): void {
  const t = ctx.locale.bind(NAMESPACE)
  ctx.effect(() => ctx.locale.register(NAMESPACE, dictionaries), 'roleplay: transcript dictionaries')

  ctx.inject(['uiConversation'], (scope) => {
    scope.uiConversation.events.register(chatNarration)
    scope.slots.inject('conversation.chat.node', () => scope.slots.register({
      name: 'conversation.chat.node',
      key: NARRATION_NODE,
    }, narrationNode(t)))
  })
}
