import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '../../panel/slot-contract.ts'
import { AvatarsController } from './avatars-controller.ts'
import { AvatarsPage } from './AvatarsPage.tsx'
import { dictionaries, type AvatarsLocaleKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    'roleplay.avatars': AvatarsLocaleKey
  }
}

const NAMESPACE = 'roleplay.avatars'

/** Adds the Avatars page to the Role Play panel: characters to play in any world. */
export function registerAvatarsPage(ctx: Context): void {
  const t = ctx.locale.bind(NAMESPACE)
  ctx.effect(() => ctx.locale.register(NAMESPACE, dictionaries), 'roleplay: avatars dictionaries')

  const avatars = new AvatarsController()
  ctx.effect(() => () => { avatars.dispose() }, 'roleplay: avatars requests')

  ctx.slots.inject('roleplay.page', () => ctx.slots.register({
    name: 'roleplay.page',
    id: 'avatars',
    order: 5,
    label: () => t('nav'),
    locale: NAMESPACE,
    inject: () => avatars.inject(),
  }, AvatarsPage))
}
