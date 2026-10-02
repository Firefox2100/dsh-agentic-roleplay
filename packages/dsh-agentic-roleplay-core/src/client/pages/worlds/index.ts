import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '../../panel/slot-contract.ts'
import { WorldsPage } from './WorldsPage.tsx'
import { dictionaries, type WorldsLocaleKey } from './locales.ts'
import { WorldsController } from './worlds-controller.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    'roleplay.worlds': WorldsLocaleKey
  }
}

const NAMESPACE = 'roleplay.worlds'

/** Adds the Worlds page to the Role Play panel. */
export function registerWorldsPage(ctx: Context): void {
  const t = ctx.locale.bind(NAMESPACE)
  ctx.effect(() => ctx.locale.register(NAMESPACE, dictionaries), 'roleplay: worlds dictionaries')

  const worlds = new WorldsController()
  ctx.effect(() => () => { worlds.dispose() }, 'roleplay: worlds requests')

  ctx.slots.inject('roleplay.page', () => ctx.slots.register({
    name: 'roleplay.page',
    id: 'worlds',
    order: 0,
    label: () => t('nav'),
    locale: NAMESPACE,
    inject: () => worlds.inject(),
  }, WorldsPage))
}
