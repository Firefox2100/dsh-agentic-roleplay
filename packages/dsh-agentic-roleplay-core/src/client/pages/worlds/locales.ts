import type { Dictionaries } from '../../i18n.ts'

export type WorldsLocaleKey =
  | 'nav' | 'loading' | 'loadFailed' | 'empty'
  | 'countOne' | 'countOther'
  | 'refresh' | 'refreshing'
  | 'previousPage' | 'nextPage' | 'pageOf'
  | 'problems'

export const dictionaries: Dictionaries<WorldsLocaleKey> = {
  en: {
    nav: 'Worlds',
    loading: 'Loading worlds…',
    loadFailed: 'Could not load worlds: {message}',
    empty: 'No worlds yet. Put a folder with a world.json inside {directory}.',
    countOne: '{count} world',
    countOther: '{count} worlds',
    refresh: 'Refresh',
    refreshing: 'Refreshing…',
    previousPage: 'Previous page',
    nextPage: 'Next page',
    pageOf: 'Page {page} of {pages}',
    problems: '{count} problem(s) found while reading worlds',
  },
  zh: {
    nav: '世界卡',
    loading: '正在加载世界卡…',
    loadFailed: '无法加载世界卡：{message}',
    empty: '还没有世界卡。请在 {directory} 中新建文件夹并放入 world.json。',
    countOne: '{count} 张世界卡',
    countOther: '{count} 张世界卡',
    refresh: '刷新',
    refreshing: '刷新中…',
    previousPage: '上一页',
    nextPage: '下一页',
    pageOf: '第 {page} 页，共 {pages} 页',
    problems: '读取世界卡时发现 {count} 个问题',
  },
}
