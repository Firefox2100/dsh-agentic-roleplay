import type { Dictionaries } from '../../i18n.ts'

export type SessionsLocaleKey =
  | 'nav' | 'loading' | 'loadFailed' | 'empty'
  | 'countOne' | 'countOther'
  | 'refresh' | 'refreshing'
  | 'previousPage' | 'nextPage' | 'pageOf'
  | 'problems'
  | 'columnName' | 'columnWorld' | 'columnCreated' | 'columnLastPlayed' | 'columnTurns'
  | 'columnActions' | 'neverPlayed' | 'dateLocale'
  | 'open' | 'openFailed'
  | 'delete' | 'deleteTitle' | 'deleteQuestion' | 'deleteWarning' | 'deleteConfirm' | 'deleting' | 'deleteFailed' | 'cancel' | 'close'

export const dictionaries: Dictionaries<SessionsLocaleKey> = {
  en: {
    nav: 'Sessions',
    loading: 'Loading sessions…',
    loadFailed: 'Could not load sessions: {message}',
    empty: 'No sessions yet. Press play on a world to start one.',
    countOne: '{count} session',
    countOther: '{count} sessions',
    refresh: 'Refresh',
    refreshing: 'Refreshing…',
    previousPage: 'Previous page',
    nextPage: 'Next page',
    pageOf: 'Page {page} of {pages}',
    problems: '{count} session(s) could not be read',
    columnName: 'Name',
    columnWorld: 'World',
    columnCreated: 'Created',
    columnLastPlayed: 'Last played',
    columnTurns: 'Turns',
    columnActions: 'Actions',
    open: 'Open the chat',
    openFailed: 'Could not open the chat: {message}',
    delete: 'Delete session',
    deleteTitle: 'Delete session',
    deleteQuestion: 'Delete the session "{name}"?',
    deleteWarning: 'Its characters, state and everything else saved with it are removed permanently.',
    deleteConfirm: 'Delete',
    deleting: 'Deleting…',
    deleteFailed: 'Could not delete the session: {message}',
    cancel: 'Cancel',
    close: 'Close',
    neverPlayed: 'Never',
    dateLocale: 'en-GB',
  },
  zh: {
    nav: '存档',
    loading: '正在加载存档…',
    loadFailed: '无法加载存档：{message}',
    empty: '还没有存档。请在世界卡上点击开始。',
    countOne: '{count} 个存档',
    countOther: '{count} 个存档',
    refresh: '刷新',
    refreshing: '刷新中…',
    previousPage: '上一页',
    nextPage: '下一页',
    pageOf: '第 {page} 页，共 {pages} 页',
    problems: '{count} 个存档无法读取',
    columnName: '名称',
    columnWorld: '世界卡',
    columnCreated: '创建时间',
    columnLastPlayed: '上次游玩',
    columnTurns: '回合数',
    columnActions: '操作',
    open: '打开对话',
    openFailed: '无法打开对话：{message}',
    delete: '删除存档',
    deleteTitle: '删除存档',
    deleteQuestion: '删除存档“{name}”？',
    deleteWarning: '存档中的角色、状态及所有已保存的内容将被永久删除。',
    deleteConfirm: '删除',
    deleting: '正在删除…',
    deleteFailed: '无法删除存档：{message}',
    cancel: '取消',
    close: '关闭',
    neverPlayed: '从未',
    dateLocale: 'zh-CN',
  },
}
