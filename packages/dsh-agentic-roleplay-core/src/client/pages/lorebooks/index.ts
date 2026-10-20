import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import { createChatOpener } from '../../chat/open-chat.ts'
import type {} from '../../panel/slot-contract.ts'
import { LorebooksPage } from './LorebooksPage.tsx'
import { dictionaries, type LorebooksLocaleKey } from './locales.ts'
import { LorebooksController } from './lorebooks-controller.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    'roleplay.lorebooks': LorebooksLocaleKey
  }
}

const NAMESPACE = 'roleplay.lorebooks'

/** Adds the Lorebooks page to the Role Play panel: reusable background knowledge that stories start with. */
export function registerLorebooksPage(ctx: Context): void {
  const t = ctx.locale.bind(NAMESPACE)
  ctx.effect(() => ctx.locale.register(NAMESPACE, dictionaries), 'roleplay: lorebooks dictionaries')

  const lorebooks = new LorebooksController(createChatOpener(ctx), () => t('language'))
  ctx.effect(() => () => { lorebooks.dispose() }, 'roleplay: lorebooks requests')

  ctx.slots.inject('roleplay.page', () => ctx.slots.register({
    name: 'roleplay.page',
    id: 'lorebooks',
    order: 8,
    label: () => t('nav'),
    locale: NAMESPACE,
    inject: () => lorebooks.inject(),
  }, LorebooksPage))
}
