import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import { createChatOpener } from '../../chat/open-chat.ts'
import { CATALOGUE_KEYS_CHANGED } from '../../../shared/catalogue.ts'
import { ENTRY_ID } from '../../../shared/ids.ts'
import type {} from '../../panel/slot-contract.ts'
import { CatalogueController } from './catalogue-controller.ts'
import { CataloguePage } from './CataloguePage.tsx'
import { dictionaries, type CatalogueLocaleKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    'roleplay.catalogue': CatalogueLocaleKey
  }
}

const NAMESPACE = 'roleplay.catalogue'

/** Adds the Catalogue page to the Role Play panel: worlds of the catalogues set up in the settings. */
export function registerCataloguePage(ctx: Context): void {
  const t = ctx.locale.bind(NAMESPACE)
  ctx.effect(() => ctx.locale.register(NAMESPACE, dictionaries), 'roleplay: catalogue dictionaries')

  const catalogue = new CatalogueController(createChatOpener(ctx))
  ctx.effect(() => () => { catalogue.dispose() }, 'roleplay: catalogue requests')
  // Saving the settings changes which catalogues exist; storing or removing a key changes which have one: the page follows both.
  ctx.effect(() => ctx.configForms.get(ENTRY_ID).subscribe(() => { void catalogue.read() }), 'roleplay: catalogue settings')
  ctx.effect(() => {
    const again = (): void => { void catalogue.read() }
    window.addEventListener(CATALOGUE_KEYS_CHANGED, again)
    return () => { window.removeEventListener(CATALOGUE_KEYS_CHANGED, again) }
  }, 'roleplay: catalogue keys')

  ctx.slots.inject('roleplay.page', () => ctx.slots.register({
    name: 'roleplay.page',
    id: 'catalogue',
    order: 3,
    label: () => t('nav'),
    locale: NAMESPACE,
    inject: () => catalogue.inject(),
  }, CataloguePage))
}
