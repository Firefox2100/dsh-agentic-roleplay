import type {} from '@deepseek-ai/dsh-client-ui-slots'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface SlotMap {
    /**
     * One page of the Role Play panel. The panel turns each entry into a nav
     * item (`id`, `order`, `label`) and renders the selected one.
     */
    'roleplay.page': { kind: 'list'; scope: 'root'; owner: RoleplayPageOwnerProps }
  }
}

/** The panel passes nothing to its pages. */
export interface RoleplayPageOwnerProps {
  children?: never
}
