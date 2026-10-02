import type { SnapshotStore } from '@deepseek-ai/dsh-client-store'
import {
  SettingsFormModel,
  settingsTextField,
  type SettingsFieldState,
  type SettingsFormActions,
  type SettingsFormScope,
  type SettingsFormShell,
} from '@deepseek-ai/dsh-client-ui-primitives'

export interface RoleplaySettings {
  rootPath?: string
}

export interface RoleplaySettingsState extends SettingsFormShell {
  rootPath: SettingsFieldState
}

export interface RoleplaySettingsFace extends SettingsFormActions {
  hooks: {
    /** Bound by the renderer as `useRoleplaySettings`. */
    roleplaySettings: SnapshotStore<RoleplaySettingsState>
  }
}

/** Stages the role play settings form over the host plugin's configuration entry. */
export class RoleplaySettingsController {
  private readonly form: SettingsFormModel<RoleplaySettings>
  private readonly store: SnapshotStore<RoleplaySettingsState>

  constructor(scope: SettingsFormScope<RoleplaySettings>) {
    this.form = new SettingsFormModel(scope, [settingsTextField('rootPath')])
    this.store = this.form.bind(() => ({
      ...this.form.shell(),
      rootPath: this.form.field('rootPath'),
    }))
  }

  inject(): RoleplaySettingsFace {
    return { hooks: { roleplaySettings: this.store }, ...this.form.actions() }
  }

  dispose(): void {
    this.form.dispose()
  }
}
