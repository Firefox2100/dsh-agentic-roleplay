import type { Context } from '@deepseek-ai/cordis'
import type { ConversationViewDefinition } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import { dictionaries, type WorldLocaleKey } from '../world-editor/locales.ts'
import { WorldTab } from './WorldTab.tsx'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    'roleplay.world': WorldLocaleKey
  }
}

const NAMESPACE = 'roleplay.world'
const VIEW_ID = 'roleplay-world'

/** The shell activates a data target for every view tab; this tab reads from the host itself, so its target is empty. */
const worldTarget: ConversationViewDefinition<never, Record<string, never>> = {
  target: VIEW_ID,
  create: () => ({ empty: {}, replace: () => ({}), apply: () => ({}) }),
}

/** Adds the World tab beside Chat: the state of the story, by the part of the world. */
export function registerWorld(ctx: Context): void {
  const t = ctx.locale.bind(NAMESPACE)
  ctx.effect(() => ctx.locale.register(NAMESPACE, dictionaries), 'roleplay: world dictionaries')

  ctx.inject(['uiConversation'], (scope) => {
    scope.uiConversation.views.register(worldTarget as never)
    scope.slots.inject('conversation.view', () => scope.slots.register({
      name: 'conversation.view',
      id: VIEW_ID,
      order: 10,
      label: () => t('tab'),
      locale: NAMESPACE,
    }, WorldTab))
  })
}
