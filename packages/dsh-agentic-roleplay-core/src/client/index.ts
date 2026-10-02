import type { Context } from '@deepseek-ai/cordis'
import { registerPanel } from './panel/index.ts'
import { registerSessionsPage } from './pages/sessions/index.ts'
import { registerWorldsPage } from './pages/worlds/index.ts'
import { registerSettings } from './settings/index.ts'

/** Union of what every feature needs. */
export const inject = ['slots', 'locale', 'configForms']

export function apply(ctx: Context): void {
  registerSettings(ctx)
  registerPanel(ctx)
  registerWorldsPage(ctx)
  registerSessionsPage(ctx)
}
