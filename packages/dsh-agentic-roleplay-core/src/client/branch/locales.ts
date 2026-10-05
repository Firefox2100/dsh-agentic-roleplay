import type { Dictionaries } from '../i18n.ts'

export type BranchLocaleKey = 'title' | 'description' | 'name' | 'save' | 'saving' | 'keep' | 'close' | 'failed'

export const dictionaries: Dictionaries<BranchLocaleKey> = {
  en: {
    title: 'Name the branch',
    description: 'A new session was made from the story at this point; the first one is as it was.',
    name: 'Name',
    save: 'Save',
    saving: 'Saving…',
    keep: 'Keep this name',
    close: 'Close',
    failed: 'Could not rename the session: {message}',
  },
  zh: {
    title: '为分支命名',
    description: '已从故事的这一刻另存为新的会话，原会话保持不变。',
    name: '名称',
    save: '保存',
    saving: '正在保存…',
    keep: '保留此名称',
    close: '关闭',
    failed: '无法重命名会话：{message}',
  },
}
