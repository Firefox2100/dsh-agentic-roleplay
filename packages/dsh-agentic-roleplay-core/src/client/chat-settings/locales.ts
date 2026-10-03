import { withDictionaries, type Dictionaries } from '../i18n.ts'
import { dictionaries as form, type SettingsFormKey } from '../settings-form/locales.ts'

export type ChatSettingsLocaleKey =
  | SettingsFormKey
  | 'tab' | 'title' | 'description' | 'loading' | 'loadFailed' | 'notRoleplay'
  | 'pendingRecords' | 'save' | 'saving' | 'saved' | 'saveFailed'

const own: Dictionaries<Exclude<ChatSettingsLocaleKey, SettingsFormKey>> = {
  en: {
    tab: 'Chat settings',
    title: 'Chat settings',
    description: 'These apply to this chat only and take effect from the next round, with no restart.',
    loading: 'Loading settings…',
    loadFailed: 'Could not load the settings: {message}',
    notRoleplay: 'This chat is not a roleplay session, so it has no roleplay settings.',
    pendingRecords: '{count} round(s) are not yet written into the story\'s records. They will be written with the next turn.',
    save: 'Save',
    saving: 'Saving…',
    saved: 'Saved.',
    saveFailed: 'Could not save the settings: {message}',
  },
  zh: {
    tab: '对话设置',
    title: '对话设置',
    description: '这些设置只对当前对话生效，从下一轮开始起作用，无需重启。',
    loading: '正在加载设置…',
    loadFailed: '无法加载设置：{message}',
    notRoleplay: '此对话不是角色扮演存档，没有角色扮演设置。',
    pendingRecords: '有 {count} 个回合尚未写入故事记录，将在下一轮一并写入。',
    save: '保存',
    saving: '正在保存…',
    saved: '已保存。',
    saveFailed: '无法保存设置：{message}',
  },
}

export const dictionaries = withDictionaries(own, form)
