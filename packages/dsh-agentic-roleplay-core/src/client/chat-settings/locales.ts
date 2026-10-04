import { withDictionaries, type Dictionaries } from '../i18n.ts'
import { dictionaries as form, type SettingsFormKey } from '../settings-form/locales.ts'

export type ChatSettingsLocaleKey =
  | SettingsFormKey
  | 'tab' | 'title' | 'description' | 'loading' | 'loadFailed' | 'notRoleplay'
  | 'pendingRecords' | 'pendingConsolidation' | 'save' | 'saving' | 'saved' | 'saveFailed'

const own: Dictionaries<Exclude<ChatSettingsLocaleKey, SettingsFormKey>> = {
  en: {
    tab: 'Chat settings',
    title: 'Chat settings',
    description: 'These apply to this chat only and take effect from the next round, with no restart.',
    loading: 'Loading settings…',
    loadFailed: 'Could not load the settings: {message}',
    notRoleplay: 'This chat is not a roleplay session, so it has no roleplay settings.',
    pendingConsolidation: '{count} character(s), place(s) or thing(s) made up in play are waiting to be fitted into the world (connected to the rest, given relationships). It is done in the background.',
    pendingRecords: '{count} round(s) are waiting to be written into the story\'s memory. The game master records them when the story moves on, or once too many pile up.',
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
    pendingConsolidation: '有 {count} 个在故事中新建的角色、地点或物品等待融入世界（与其余部分建立连接和关系），将在后台完成。',
    pendingRecords: '有 {count} 个回合等待写入故事记忆。主持人会在故事推进时记录，积压过多时也会自动记录。',
    save: '保存',
    saving: '正在保存…',
    saved: '已保存。',
    saveFailed: '无法保存设置：{message}',
  },
}

export const dictionaries = withDictionaries(own, form)
