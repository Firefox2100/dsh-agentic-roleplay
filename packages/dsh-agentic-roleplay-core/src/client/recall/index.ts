import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import { IconSearchOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import { dictionaries, type RecallLocaleKey } from './locales.ts'
import { RECALL_ID, RECALL_KIND, RecallBody, RecallGuide } from './RecallTab.tsx'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    'roleplay.recall': RecallLocaleKey
  }
}

const NAMESPACE = 'roleplay.recall'

/** The recall check: a page of the right sidebar, beside the chat, that shows what a moment would bring back for the characters. */
export function registerRecall(ctx: Context): void {
  const t = ctx.locale.bind(NAMESPACE)
  ctx.effect(() => ctx.locale.register(NAMESPACE, dictionaries), 'roleplay: recall dictionaries')

  ctx.inject(['sidebarRight', 'sidebarRightTabs'], (right) => {
    right.effect(() => right.sidebarRightTabs.register({
      id: RECALL_ID,
      kind: RECALL_KIND,
      keepMounted: true,
      title: () => t('tab'),
      guide: [{ id: 'recall', order: 31, title: () => t('title'), description: () => t('description'), icon: IconSearchOutlineRegular }],
    }), 'roleplay: recall tab type')
    right.effect(() => right.slots.inject('sidebar.right.tab.guide.entry', () => right.slots.register({
      name: 'sidebar.right.tab.guide.entry',
      key: RECALL_ID,
      locale: NAMESPACE,
      inject: (sessionId: string) => ({ sessionId }),
    }, RecallGuide as never)), 'roleplay: recall guide entry')
    right.effect(() => right.slots.inject('sidebar.right.pane.tab', () => right.slots.register({
      name: 'sidebar.right.pane.tab',
      key: RECALL_ID,
      locale: NAMESPACE,
      inject: (sessionId: string) => ({ sessionId }),
    }, RecallBody as never)), 'roleplay: recall body')
  })
}
