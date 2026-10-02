import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import { createChatOpener } from '../../chat/open-chat.ts'
import type {} from '../../panel/slot-contract.ts'
import { SessionsPage } from './SessionsPage.tsx'
import { dictionaries, type SessionsLocaleKey } from './locales.ts'
import { SessionsController } from './sessions-controller.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    'roleplay.sessions': SessionsLocaleKey
  }
}

const NAMESPACE = 'roleplay.sessions'

/** Adds the Sessions page to the Role Play panel. */
export function registerSessionsPage(ctx: Context): void {
  const t = ctx.locale.bind(NAMESPACE)
  ctx.effect(() => ctx.locale.register(NAMESPACE, dictionaries), 'roleplay: sessions dictionaries')

  const sessions = new SessionsController(createChatOpener(ctx))
  ctx.effect(() => () => { sessions.dispose() }, 'roleplay: sessions requests')

  ctx.slots.inject('roleplay.page', () => ctx.slots.register({
    name: 'roleplay.page',
    id: 'sessions',
    order: 10,
    label: () => t('nav'),
    locale: NAMESPACE,
    inject: () => sessions.inject(),
  }, SessionsPage))
}
