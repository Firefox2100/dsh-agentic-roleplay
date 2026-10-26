import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '../../panel/slot-contract.ts'
import { SyncPage } from './SyncPage.tsx'
import { dictionaries, type SyncLocaleKey } from './locales.ts'
import { SyncController } from './sync-controller.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    'roleplay.sync': SyncLocaleKey
  }
}

const NAMESPACE = 'roleplay.sync'

/** Adds the Sync page to the Role Play panel: what is in step with the remote and what needs a choice. */
export function registerSyncPage(ctx: Context): void {
  const t = ctx.locale.bind(NAMESPACE)
  ctx.effect(() => ctx.locale.register(NAMESPACE, dictionaries), 'roleplay: sync dictionaries')

  const sync = new SyncController()
  ctx.effect(() => () => { sync.dispose() }, 'roleplay: sync requests')

  ctx.slots.inject('roleplay.page', () => ctx.slots.register({
    name: 'roleplay.page',
    id: 'sync',
    order: 12,
    label: () => t('nav'),
    locale: NAMESPACE,
    inject: () => sync.inject(),
  }, SyncPage))
}
