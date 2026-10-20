import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import { createChatOpener } from '../../chat/open-chat.ts'
import type {} from '../../panel/slot-contract.ts'
import { PresetsPage } from './PresetsPage.tsx'
import { dictionaries, type PresetsLocaleKey } from './locales.ts'
import { PresetsController } from './presets-controller.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    'roleplay.presets': PresetsLocaleKey
  }
}

const NAMESPACE = 'roleplay.presets'

/** Adds the Presets page to the Role Play panel: reusable writing instructions for stories. */
export function registerPresetsPage(ctx: Context): void {
  const t = ctx.locale.bind(NAMESPACE)
  ctx.effect(() => ctx.locale.register(NAMESPACE, dictionaries), 'roleplay: presets dictionaries')

  const presets = new PresetsController(createChatOpener(ctx), () => t('language'))
  ctx.effect(() => () => { presets.dispose() }, 'roleplay: presets requests')

  ctx.slots.inject('roleplay.page', () => ctx.slots.register({
    name: 'roleplay.page',
    id: 'presets',
    order: 7,
    label: () => t('nav'),
    locale: NAMESPACE,
    inject: () => presets.inject(),
  }, PresetsPage))
}
