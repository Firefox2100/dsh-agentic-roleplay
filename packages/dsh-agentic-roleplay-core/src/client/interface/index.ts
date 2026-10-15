import type { Context } from '@deepseek-ai/cordis'
import type { ConversationViewDefinition } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type { PackToken } from '../../shared/interface-pack.ts'
import { facadeOf } from '../chat-input.ts'
import { availability } from './api.ts'
import { PackDock } from './PackDock.tsx'
import { InterfaceTab } from './InterfaceTab.tsx'
import { SIDEBAR_ID, SIDEBAR_KIND, SidebarBody, SidebarGuide } from './SidebarPage.tsx'
import { IconGlobeOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import { dictionaries, type InterfaceLocaleKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    'roleplay.interface': InterfaceLocaleKey
  }
}

const NAMESPACE = 'roleplay.interface'
const VIEW_ID = 'roleplay-interface'

/** The slice of DSH's theme service that lays colours over the palette. */
interface ThemeLike {
  overrideTokens(source: string, tokens: Record<string, PackToken>): () => void
}

/** The shell activates a data target for every view tab; the pack's tab reads from the host itself, so its target is empty. */
const target: ConversationViewDefinition<never, Record<string, never>> = {
  target: VIEW_ID,
  create: () => ({ empty: {}, replace: () => ({}), apply: () => ({}) }),
}

/**
 * Interface packs: what a story's files add to the page. The status strip and the pack's colours and skin come with the
 * dock above the input box; the tab is offered only when some pack has one, which the host is asked when the page loads.
 */
export function registerInterface(ctx: Context): void {
  const t = ctx.locale.bind(NAMESPACE)
  ctx.effect(() => ctx.locale.register(NAMESPACE, dictionaries), 'roleplay: interface dictionaries')

  ctx.inject(['uiConversation'], (scope) => {
    const input = (sessionId: string) => {
      const facade = facadeOf(scope, sessionId)
      return {
        say: (text: string) => { facade.fill(text, true) },
        fill: (text: string) => { facade.fill(text, false) },
        // Resolved on use: a client without the right sidebar cannot show the page.
        open: (surface: 'tab' | 'sidebar') => {
          if (surface === 'sidebar') (scope.get('sidebarRight' as never) as { openTab(kind: string): void } | undefined)?.openTab(SIDEBAR_KIND)
          else scope.uiConversation.binding(sessionId as never).activate(VIEW_ID)
        },
      }
    }
    // Resolved on use: a client without the theme service shows the pack without its colours.
    const overrideTokens = (source: string, tokens: Record<string, PackToken>): (() => void) => (scope.get('theme' as never) as ThemeLike | undefined)?.overrideTokens(source, tokens) ?? (() => undefined)
    for (const [surface, order] of [['opening', 1], ['hud', 3], ['dock', 20]] as const) {
      scope.slots.inject('conversation.input.dock', () => scope.slots.register({
        name: 'conversation.input.dock',
        id: `roleplay-${surface}`,
        order,
        locale: NAMESPACE,
        inject: (sessionId: string) => ({ surface, frameInput: input(sessionId), overrideTokens }),
      }, PackDock))
    }

    // The pack's page in the right sidebar: a tab type, its entry in the guide, and its body.
    scope.inject(['sidebarRight', 'sidebarRightTabs'], (right) => {
      right.effect(() => right.sidebarRightTabs.register({
        id: SIDEBAR_ID,
        kind: SIDEBAR_KIND,
        keepMounted: true,
        title: () => t('sidebarTitle'),
        guide: [{ id: 'page', order: 30, title: () => t('sidebarTitle'), description: () => t('sidebarDescription'), icon: IconGlobeOutlineRegular }],
      }), 'roleplay: sidebar tab type')
      right.effect(() => right.slots.inject('sidebar.right.tab.guide.entry', () => right.slots.register({
        name: 'sidebar.right.tab.guide.entry',
        key: SIDEBAR_ID,
        locale: NAMESPACE,
        inject: (sessionId: string) => ({ sessionId }),
      }, SidebarGuide as never)), 'roleplay: sidebar guide entry')
      right.effect(() => right.slots.inject('sidebar.right.pane.tab', () => right.slots.register({
        name: 'sidebar.right.pane.tab',
        key: SIDEBAR_ID,
        locale: NAMESPACE,
        inject: (sessionId: string) => ({ sessionId, frameInput: input(sessionId) }),
      }, SidebarBody as never)), 'roleplay: sidebar body')
    })

    let offered = false
    void availability().then((found) => {
      if (!found.tab || offered) return
      offered = true
      scope.uiConversation.views.register(target as never)
      scope.slots.inject('conversation.view', () => scope.slots.register({
        name: 'conversation.view',
        id: VIEW_ID,
        order: 18,
        label: () => t('tab'),
        locale: NAMESPACE,
        inject: () => ({ frameInput: input }) as never,
      }, InterfaceTab as never))
    }).catch((error: unknown) => { console.warn('roleplay: the interface packs could not be looked up', error) })
  })
}
