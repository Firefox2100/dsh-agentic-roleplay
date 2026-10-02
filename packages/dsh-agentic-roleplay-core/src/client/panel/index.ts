import type { Context } from '@deepseek-ai/cordis'
// Type-only: these pull in the Context and SlotMap augmentations this feature relies on.
import type { MainPanelId } from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import { PANEL_ID } from '../../shared/ids.ts'
import { PanelIcon } from './PanelIcon.tsx'
import { RoleplayPanel, type PanelFace } from './RoleplayPanel.tsx'
import { dictionaries, type PanelLocaleKey } from './locales.ts'
import { createPagesSource } from './pages-source.ts'
import { createPanelStore } from './panel-store.ts'
import type {} from './slot-contract.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    'roleplay.panel': PanelLocaleKey
  }
}

const NAMESPACE = 'roleplay.panel'

/** Adds the Role Play entry to the sidebar and the main panel it opens. */
export function registerPanel(ctx: Context): void {
  const t = ctx.locale.bind(NAMESPACE)
  ctx.effect(() => ctx.locale.register(NAMESPACE, dictionaries), 'roleplay: panel dictionaries')

  const pages = createPagesSource(ctx)
  ctx.effect(() => pages.start(), 'roleplay: page list')

  // One store instance for the registration, so the selected page survives leaving and re-entering the panel.
  const handle = createPanelStore()
  const instance = handle.create()
  const store: typeof handle = { ...handle, create: () => instance }

  ctx.slots.inject('main', () => ctx.slots.register({
    name: 'main',
    key: PANEL_ID as MainPanelId,
    locale: NAMESPACE,
    store,
    inject: (): PanelFace => ({ hooks: { pages: pages.store } }),
    children: { 'roleplay.page': { kind: 'list', scope: 'root' } },
  }, RoleplayPanel))

  // Order 5 places the entry directly under Plugins (order 0).
  ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
    name: 'sidebar.panellist',
    id: PANEL_ID,
    order: 5,
    label: () => t('label'),
    locale: NAMESPACE,
  }, PanelIcon))
}
