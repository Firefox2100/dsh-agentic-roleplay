import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import { dictionaries } from './locales.ts'

const NAMESPACE = 'roleplay.card'

/**
 * What the card tab is made of, taken as arguments rather than imported so this registration can be tested without
 * React: the shell's tab machinery is the same either way.
 */
export interface CardViews {
  id: string
  kind: string
  /** The icon of the guide entry. */
  icon: unknown
  /** The entry that opens the card. */
  guide: unknown
  /** The page of the right sidebar. */
  body: unknown
}

/**
 * The card an authored world was imported from: a page of the right sidebar, offered only where there is one, so it
 * can be read beside the world and the chat.
 */
export function registerCard(ctx: Context, views: CardViews): void {
  const t = ctx.locale.bind(NAMESPACE)
  ctx.effect(() => ctx.locale.register(NAMESPACE, dictionaries), 'roleplay: card dictionaries')

  ctx.inject(['sidebarRight', 'sidebarRightTabs'], (right) => {
    right.effect(() => right.sidebarRightTabs.register({
      id: views.id,
      kind: views.kind,
      keepMounted: true,
      title: () => t('tab'),
      guide: [{ id: 'card', order: 34, title: () => t('tab'), description: () => t('guideText'), icon: views.icon as never }],
    }), 'roleplay: card tab type')
    right.effect(() => right.slots.inject('sidebar.right.tab.guide.entry', () => right.slots.register({
      name: 'sidebar.right.tab.guide.entry',
      key: views.id,
      locale: NAMESPACE,
      inject: (sessionId: string) => ({ sessionId }),
    }, views.guide as never)), 'roleplay: card guide entry')
    right.effect(() => right.slots.inject('sidebar.right.pane.tab', () => right.slots.register({
      name: 'sidebar.right.pane.tab',
      key: views.id,
      locale: NAMESPACE,
      inject: (sessionId: string) => ({ sessionId }),
    }, views.body as never)), 'roleplay: card body')
  })
}
