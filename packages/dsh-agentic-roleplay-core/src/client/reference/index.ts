import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import { createSlotList } from '../widgets/slot-list/slot-list.ts'
import { dictionaries, type ReferenceLocaleKey } from './locales.ts'
import { REFERENCE_ID, REFERENCE_KIND, ReferenceBody, ReferenceGuide, type ReferenceFace } from './ReferenceTab.tsx'
import { JournalPage } from './sections/Journal.tsx'
import { RelationsPage } from './sections/Relations.tsx'
import { MapPage } from './sections/Map.tsx'
import { PeoplePage, PlacesPage, ProfilePage, QuestsPage, StatusPage, ThingsPage } from './sections/sections.tsx'
import type {} from './slot-contract.ts'import { IconListPen } from '../ui/icons.tsx'


declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    'roleplay.reference': ReferenceLocaleKey
  }
}

const NAMESPACE = 'roleplay.reference'

/**
 * The reference: a page of the right sidebar with what the player may look up beside the story. Its pages are entries of
 * `roleplay.reference.section`, so a profile, a map, a journal or what the character remembers is one more registration.
 */
export function registerReference(ctx: Context): void {
  const t = ctx.locale.bind(NAMESPACE)
  ctx.effect(() => ctx.locale.register(NAMESPACE, dictionaries), 'roleplay: reference dictionaries')

  const sections = createSlotList(ctx, 'roleplay.reference.section')
  ctx.effect(() => sections.start(), 'roleplay: reference page list')

  const pages: { id: string; order: number; label: 'status' | 'profile' | 'people' | 'relations' | 'quests' | 'places' | 'map' | 'things' | 'journal'; component: typeof PeoplePage }[] = [
    { id: 'status', order: 3, label: 'status', component: StatusPage },
    { id: 'profile', order: 5, label: 'profile', component: ProfilePage },
    { id: 'people', order: 10, label: 'people', component: PeoplePage },
    { id: 'relations', order: 12, label: 'relations', component: RelationsPage },
    { id: 'quests', order: 15, label: 'quests', component: QuestsPage },
    { id: 'places', order: 20, label: 'places', component: PlacesPage },
    { id: 'map', order: 25, label: 'map', component: MapPage },
    { id: 'things', order: 30, label: 'things', component: ThingsPage },
    { id: 'journal', order: 40, label: 'journal', component: JournalPage },
  ]
  for (const page of pages) {
    ctx.slots.inject('roleplay.reference.section', () => ctx.slots.register({
      name: 'roleplay.reference.section',
      id: page.id,
      order: page.order,
      label: () => t(page.label),
      locale: NAMESPACE,
    }, page.component))
  }

  ctx.inject(['sidebarRight', 'sidebarRightTabs'], (right) => {
    right.effect(() => right.sidebarRightTabs.register({
      id: REFERENCE_ID,
      kind: REFERENCE_KIND,
      keepMounted: true,
      title: () => t('tab'),
      guide: [{ id: 'reference', order: 30, title: () => t('title'), description: () => t('description'), icon: IconListPen }],
    }), 'roleplay: reference tab type')
    right.effect(() => right.slots.inject('sidebar.right.tab.guide.entry', () => right.slots.register({
      name: 'sidebar.right.tab.guide.entry',
      key: REFERENCE_ID,
      locale: NAMESPACE,
      inject: (sessionId: string) => ({ sessionId }),
    }, ReferenceGuide as never)), 'roleplay: reference guide entry')
    right.effect(() => right.slots.inject('sidebar.right.pane.tab', () => right.slots.register({
      name: 'sidebar.right.pane.tab',
      key: REFERENCE_ID,
      locale: NAMESPACE,
      inject: (sessionId: string): ReferenceFace & { sessionId: string } => ({ sessionId, hooks: { sections: sections.store } }),
      children: { 'roleplay.reference.section': { kind: 'list', scope: 'root' } },
    }, ReferenceBody as never)), 'roleplay: reference body')
  })
}
