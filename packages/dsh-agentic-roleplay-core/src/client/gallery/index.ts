import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import { IconBrowseOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import { GALLERY_ID, GALLERY_KIND, GalleryBody, GalleryGuide } from './GalleryTab.tsx'
import { dictionaries, type GalleryLocaleKey } from '../widgets/gallery-view/locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    'roleplay.gallery': GalleryLocaleKey
  }
}

const NAMESPACE = 'roleplay.gallery'

/** The gallery: a page of the right sidebar, so the pictures can be browsed while the story is read. */
export function registerGallery(ctx: Context): void {
  const t = ctx.locale.bind(NAMESPACE)
  ctx.effect(() => ctx.locale.register(NAMESPACE, dictionaries), 'roleplay: gallery dictionaries')

  ctx.inject(['sidebarRight', 'sidebarRightTabs'], (right) => {
    right.effect(() => right.sidebarRightTabs.register({
      id: GALLERY_ID,
      kind: GALLERY_KIND,
      keepMounted: true,
      title: () => t('tab'),
      guide: [{ id: 'gallery', order: 32, title: () => t('tab'), description: () => t('guideText'), icon: IconBrowseOutlineRegular }],
    }), 'roleplay: gallery tab type')
    right.effect(() => right.slots.inject('sidebar.right.tab.guide.entry', () => right.slots.register({
      name: 'sidebar.right.tab.guide.entry',
      key: GALLERY_ID,
      locale: NAMESPACE,
      inject: (sessionId: string) => ({ sessionId }),
    }, GalleryGuide as never)), 'roleplay: gallery guide entry')
    right.effect(() => right.slots.inject('sidebar.right.pane.tab', () => right.slots.register({
      name: 'sidebar.right.pane.tab',
      key: GALLERY_ID,
      locale: NAMESPACE,
      inject: (sessionId: string) => ({ sessionId }),
    }, GalleryBody as never)), 'roleplay: gallery body')
  })
}
