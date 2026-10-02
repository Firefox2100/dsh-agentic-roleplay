import type { Context } from '@deepseek-ai/cordis'
// Type-only: these pull in the Context and SlotMap augmentations this feature relies on.
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import { ENTRY_ID } from '../../shared/ids.ts'
import { RoleplaySection } from './RoleplaySection.tsx'
import { dictionaries, type SettingsLocaleKey } from './locales.ts'
import { RoleplaySettingsController } from './settings-controller.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    'roleplay.settings': SettingsLocaleKey
  }
}

const NAMESPACE = 'roleplay.settings'

/** Adds the Role Play section to the settings modal. */
export function registerSettings(ctx: Context): void {
  const t = ctx.locale.bind(NAMESPACE)
  ctx.effect(() => ctx.locale.register(NAMESPACE, dictionaries), 'roleplay: settings dictionaries')

  const settings = new RoleplaySettingsController(ctx.configForms.get(ENTRY_ID))
  ctx.effect(() => () => { settings.dispose() }, 'roleplay: settings form')

  // The section only exists while the host plugin is loaded and serves its form.
  ctx.effect(
    () => ctx.configForms.whileServed([ENTRY_ID], () => ctx.slots.inject('settings.section', () =>
      ctx.slots.register({
        name: 'settings.section',
        id: 'roleplay',
        order: 40,
        label: () => t('nav'),
        locale: NAMESPACE,
        inject: () => settings.inject(),
      }, RoleplaySection))),
    'roleplay: settings section',
  )
}
