import type { SettingsFormLabels } from '@deepseek-ai/dsh-client-ui-primitives'
import type { Dictionaries } from '../i18n.ts'

export type SettingsLocaleKey =
  | 'nav' | 'title' | 'description'
  | 'rootPath' | 'rootPathHint' | 'rootPathPlaceholder'
  | 'overridden' | 'reset' | 'invalid'
  | 'readOnly' | 'unavailable' | 'save' | 'saving' | 'saveFailed'

export const dictionaries: Dictionaries<SettingsLocaleKey> = {
  en: {
    nav: 'Role Play',
    title: 'Role Play',
    description: 'Where role play content is stored.',
    rootPath: 'Data folder',
    rootPathHint: 'Characters, sessions and their media live here. Use an absolute path or one starting with ~.',
    rootPathPlaceholder: '~/dsh-roleplay',
    overridden: 'Overridden',
    reset: 'Reset to default',
    invalid: 'Enter a folder path.',
    readOnly: 'This deployment stores settings read-only.',
    unavailable: 'Role play is not loaded, so it cannot be configured right now.',
    save: 'Save',
    saving: 'Saving…',
    saveFailed: 'The deployment did not accept these values; they were left for you to correct.',
  },
  zh: {
    nav: '角色扮演',
    title: '角色扮演',
    description: '角色扮演内容的存放位置。',
    rootPath: '数据文件夹',
    rootPathHint: '角色、会话及其媒体文件都存放在这里。请填写绝对路径，或以 ~ 开头的路径。',
    rootPathPlaceholder: '~/dsh-roleplay',
    overridden: '已覆盖',
    reset: '恢复默认',
    invalid: '请填写文件夹路径。',
    readOnly: '本部署的设置为只读。',
    unavailable: '角色扮演未加载，暂时无法配置。',
    save: '保存',
    saving: '保存中…',
    saveFailed: '本部署没有接受这些值，已保留供你修改。',
  },
}

export function formLabels(t: (key: SettingsLocaleKey) => string): SettingsFormLabels {
  return {
    unavailable: t('unavailable'),
    readOnly: t('readOnly'),
    saveFailed: t('saveFailed'),
    save: t('save'),
    saving: t('saving'),
  }
}
