import type { Context } from '@deepseek-ai/cordis'
import { registerPanel } from './panel/index.ts'
import { registerCataloguePage } from './pages/catalogue/index.ts'
import { registerAvatarsPage } from './pages/avatars/index.ts'
import { registerLorebooksPage } from './pages/lorebooks/index.ts'
import { registerPresetsPage } from './pages/presets/index.ts'
import { registerSessionsPage } from './pages/sessions/index.ts'
import { registerWorldsPage } from './pages/worlds/index.ts'
import { registerBranchNaming } from './branch/index.ts'
import { registerGallery } from './gallery/index.ts'
import { registerInterface } from './interface/index.ts'
import { registerWorld } from './world/index.ts'
import { registerChatSettings } from './chat-settings/index.ts'
import { registerSettings } from './settings/index.ts'
import { registerTranscript } from './transcript/index.ts'

/** Union of what every feature needs. */
export const inject = ['slots', 'locale', 'configForms']

export function apply(ctx: Context): void {
  registerSettings(ctx)
  registerPanel(ctx)
  registerWorldsPage(ctx)
  registerAvatarsPage(ctx)
  registerPresetsPage(ctx)
  registerLorebooksPage(ctx)
  registerCataloguePage(ctx)
  registerSessionsPage(ctx)
  registerTranscript(ctx)
  registerChatSettings(ctx)
  registerWorld(ctx)
  registerGallery(ctx)
  registerInterface(ctx)
  registerBranchNaming(ctx)
}
