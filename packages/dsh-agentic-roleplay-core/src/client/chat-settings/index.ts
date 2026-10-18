import type { Context } from '@deepseek-ai/cordis'
import type { ConversationViewDefinition } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import { createChatOpener } from '../chat/open-chat.ts'
import { ChatSettingsView } from './ChatSettingsView.tsx'
import { dictionaries, type ChatSettingsLocaleKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    'roleplay.chatSettings': ChatSettingsLocaleKey
  }
}

const NAMESPACE = 'roleplay.chatSettings'
const VIEW_ID = 'roleplay-settings'

/** The shell activates a data target for every view tab; this tab has no data, so its target is empty. */
const settingsTarget: ConversationViewDefinition<never, Record<string, never>> = {
  target: VIEW_ID,
  create: () => ({ empty: {}, replace: () => ({}), apply: () => ({}) }),
}

/** Adds a tab for the settings of the current chat beside Chat and Trajectory. */
export function registerChatSettings(ctx: Context): void {
  const t = ctx.locale.bind(NAMESPACE)
  ctx.effect(() => ctx.locale.register(NAMESPACE, dictionaries), 'roleplay: chat settings dictionaries')

  ctx.inject(['uiConversation'], (scope) => {
    scope.uiConversation.views.register(settingsTarget as never)
    scope.slots.inject('conversation.view', () => scope.slots.register({
      name: 'conversation.view',
      id: VIEW_ID,
      order: 20,
      label: () => t('tab'),
      locale: NAMESPACE,
      inject: () => ({ openChat: createChatOpener(ctx) }),
    }, ChatSettingsView))
  })
}
