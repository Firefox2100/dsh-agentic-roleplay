import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '../../panel/slot-contract.ts'
import { PromptsPage } from './PromptsPage.tsx'
import { dictionaries, type PromptsLocaleKey } from './locales.ts'
import { PromptsController } from './prompts-controller.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    'roleplay.prompts': PromptsLocaleKey
  }
}

const NAMESPACE = 'roleplay.prompts'

/** Adds the Prompts page to the Role Play panel: the instructions the models are given, to read and edit. */
export function registerPromptsPage(ctx: Context): void {
  const t = ctx.locale.bind(NAMESPACE)
  ctx.effect(() => ctx.locale.register(NAMESPACE, dictionaries), 'roleplay: prompts dictionaries')

  const prompts = new PromptsController()
  ctx.effect(() => () => { prompts.dispose() }, 'roleplay: prompts requests')

  ctx.slots.inject('roleplay.page', () => ctx.slots.register({
    name: 'roleplay.page',
    id: 'prompts',
    order: 9,
    label: () => t('nav'),
    locale: NAMESPACE,
    inject: () => prompts.inject(),
  }, PromptsPage))
}
