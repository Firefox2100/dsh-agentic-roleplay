import type { ReactNode } from 'react'
import { IconUsersOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'

/** Sidebar glyph; the sidebar owns the button, label and selected state around it. */
export function PanelIcon({ size }: PropsRuntime<'sidebar.panellist'>): ReactNode {
  return <IconUsersOutlineRegular size={size} />
}
