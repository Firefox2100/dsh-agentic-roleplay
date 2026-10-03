import type { Dictionaries } from '../i18n.ts'

export type ChatSettingsLocaleKey =
  | 'tab' | 'title' | 'description' | 'loading' | 'loadFailed' | 'notRoleplay'
  | 'maxRounds' | 'maxRoundsHelp' | 'invalid' | 'save' | 'saving' | 'saved' | 'saveFailed'

export const dictionaries: Dictionaries<ChatSettingsLocaleKey> = {
  en: {
    tab: 'Chat settings',
    title: 'Chat settings',
    description: 'These apply to this chat only and take effect from the next round.',
    loading: 'Loading settings…',
    loadFailed: 'Could not load the settings: {message}',
    notRoleplay: 'This chat is not a roleplay session, so it has no roleplay settings.',
    maxRounds: 'Rounds of characters per message',
    maxRoundsHelp: 'How many times the game master may hand the scene to the characters before it comes back to you. 1 means one round per message; more lets conversations between characters flow, but it will still stop earlier when the story has a natural pause.',
    invalid: 'Enter a whole number from {min} to {max}.',
    save: 'Save',
    saving: 'Saving…',
    saved: 'Saved.',
    saveFailed: 'Could not save the settings: {message}',
  },
  zh: {
    tab: '对话设置',
    title: '对话设置',
    description: '这些设置只对当前对话生效，从下一轮开始起作用。',
    loading: '正在加载设置…',
    loadFailed: '无法加载设置：{message}',
    notRoleplay: '此对话不是角色扮演存档，没有角色扮演设置。',
    maxRounds: '每条消息的角色回合数',
    maxRoundsHelp: '主持人在把场面交还给你之前，最多可以让角色行动多少轮。1 表示每条消息只有一轮；更多轮可以让角色之间的对话自然展开，但故事出现自然停顿时仍会提前交还给你。',
    invalid: '请输入 {min} 到 {max} 之间的整数。',
    save: '保存',
    saving: '正在保存…',
    saved: '已保存。',
    saveFailed: '无法保存设置：{message}',
  },
}
