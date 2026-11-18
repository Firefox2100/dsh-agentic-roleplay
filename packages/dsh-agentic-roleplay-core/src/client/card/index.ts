import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import { IconBrowse } from '../ui/icons.tsx'
import { CARD_ID, CARD_KIND, CardBody, CardGuide } from './CardTab.tsx'
import { registerCard as register } from './register.ts'

/** The card an authored world was imported from: a page of the right sidebar, offered only where there is one. */
export function registerCard(ctx: Context): void {
  register(ctx, { id: CARD_ID, kind: CARD_KIND, icon: IconBrowse, guide: CardGuide, body: CardBody })
}
