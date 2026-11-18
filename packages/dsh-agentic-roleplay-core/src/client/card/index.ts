import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import { IconBrowse } from '../ui/icons.tsx'
import { CARD_ID, CARD_KIND, CardBody, CardGuide } from './CardTab.tsx'
import { dictionaries, type CardLocaleKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    'roleplay.card': CardLocaleKey
  }
}

const NAMESPACE = 'roleplay.card'

/** The card an authored world was imported from: a page of the right sidebar, offered only where there is one, so it can be read beside the world and the chat. */
export function registerCard(ctx: Context): void {
  const t = ctx.locale.bind(NAMESPACE)
  ctx.effect(() => ctx.locale.register(NAMESPACE, dictionaries), 'roleplay: card dictionaries')

  ctx.inject(['sidebarRight', 'sidebarRightTabs'], (right) => {
    right.effect(() => right.sidebarRightTabs.register({
      id: CARD_ID,
      kind: CARD_KIND,
      keepMounted: true,
      title: () => t('tab'),
      guide: [{ id: 'card', order: 34, title: () => t('tab'), description: () => t('guideText'), icon: IconBrowse }],
    }), 'roleplay: card tab type')
    right.effect(() => right.slots.inject('sidebar.right.tab.guide.entry', () => right.slots.register({
      name: 'sidebar.right.tab.guide.entry',
      key: CARD_ID,
      locale: NAMESPACE,
      inject: (sessionId: string) => ({ sessionId }),
    }, CardGuide as never)), 'roleplay: card guide entry')
    right.effect(() => right.slots.inject('sidebar.right.pane.tab', () => right.slots.register({
      name: 'sidebar.right.pane.tab',
      key: CARD_ID,
      locale: NAMESPACE,
      inject: (sessionId: string) => ({ sessionId }),
    }, CardBody as never)), 'roleplay: card body')
  })
}
