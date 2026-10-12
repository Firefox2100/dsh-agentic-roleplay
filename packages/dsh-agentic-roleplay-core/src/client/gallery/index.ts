import type { Context } from '@deepseek-ai/cordis'
import type { ConversationViewDefinition } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import { GalleryTab } from './GalleryTab.tsx'
import { dictionaries, type GalleryLocaleKey } from '../widgets/gallery-view/locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    'roleplay.gallery': GalleryLocaleKey
  }
}

const NAMESPACE = 'roleplay.gallery'
const VIEW_ID = 'roleplay-gallery'

/** The shell activates a data target for every view tab; this tab reads from the host itself, so its target is empty. */
const galleryTarget: ConversationViewDefinition<never, Record<string, never>> = {
  target: VIEW_ID,
  create: () => ({ empty: {}, replace: () => ({}), apply: () => ({}) }),
}

/** Adds the Gallery tab beside Chat and World: every image of the session in a grid. */
export function registerGallery(ctx: Context): void {
  const t = ctx.locale.bind(NAMESPACE)
  ctx.effect(() => ctx.locale.register(NAMESPACE, dictionaries), 'roleplay: gallery dictionaries')

  ctx.inject(['uiConversation'], (scope) => {
    scope.uiConversation.views.register(galleryTarget as never)
    scope.slots.inject('conversation.view', () => scope.slots.register({
      name: 'conversation.view',
      id: VIEW_ID,
      order: 15,
      label: () => t('tab'),
      locale: NAMESPACE,
    }, GalleryTab))
  })
}
