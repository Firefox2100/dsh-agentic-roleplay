import type {} from '@deepseek-ai/dsh-client-ui-slots'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface SlotMap {
    /**
     * One page of the reference in the right sidebar (people, places, things, and whatever is added later: a map, a journal,
     * what the character remembers). The tab turns each entry into a nav item (`id`, `order`, `label`) and renders the selected one.
     */
    'roleplay.reference.section': { kind: 'list'; scope: 'root'; owner: ReferenceSectionOwnerProps }
  }
}

/** What the reference tells every page it shows. */
export interface ReferenceSectionOwnerProps {
  /** The DSH chat the sidebar belongs to. */
  sessionId: string
  /** Whether the tab is on screen: a page reads again only then. */
  visible: boolean
  children?: never
}
