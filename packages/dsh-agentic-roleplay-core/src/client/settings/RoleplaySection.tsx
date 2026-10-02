import { SettingsForm, SettingsValueField } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { formLabels } from './locales.ts'
import type { RoleplaySettingsFace } from './settings-controller.ts'

export type RoleplaySectionProps =
  PropsRuntime<'settings.section'>
  & PropsLocale<'roleplay.settings'>
  & InjectFace<RoleplaySettingsFace>

export function RoleplaySection(props: RoleplaySectionProps) {
  const { t } = props
  const state = props.useRoleplaySettings(snapshot => snapshot)
  return (
    <div>
      <h2>{t('title')}</h2>
      <p>{t('description')}</p>
      <SettingsForm labels={formLabels(t)} state={state} onSave={props.save} onDiscard={props.discard}>
        <SettingsValueField
          id="roleplay-root-path"
          label={t('rootPath')}
          hint={t('rootPathHint')}
          placeholder={t('rootPathPlaceholder')}
          overriddenLabel={t('overridden')}
          resetLabel={t('reset')}
          invalidLabel={t('invalid')}
          disabled={!state.writable}
          {...state.rootPath}
          onEdit={(text) => { props.edit('rootPath', text) }}
          onReset={() => { props.resetField('rootPath') }}
        />
      </SettingsForm>
    </div>
  )
}
