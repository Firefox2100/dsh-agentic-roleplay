import { withDictionaries, type Dictionaries } from '../../i18n.ts'
import { dictionaries as form, type SettingsFormKey } from '../../settings-form/locales.ts'

export type WorldsLocaleKey =
  | SettingsFormKey | 'advanced' | 'advancedHelp'
  | 'nav' | 'loading' | 'loadFailed' | 'empty'
  | 'countOne' | 'countOther'
  | 'refresh' | 'refreshing'
  | 'previousPage' | 'nextPage' | 'pageOf'
  | 'problems'
  | 'play' | 'chatNotOpened'
  | 'startTitle' | 'sessionName' | 'playAs' | 'loadingCharacters' | 'charactersFailed' | 'noPlayable'
  | 'start' | 'starting' | 'cancel' | 'close' | 'startFailed'

const own: Dictionaries<Exclude<WorldsLocaleKey, SettingsFormKey>> = {
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
    play: 'Start a new session',
    chatNotOpened: 'Started the session "{name}", but could not open its chat: {message}',
    advanced: 'Advanced settings',
    advancedHelp: 'These are used from the first message. You can change them later in the chat\'s settings tab.',
    startTitle: 'Start a new session',
    sessionName: 'Session name',
    playAs: 'Play as',
    loadingCharacters: 'Loading characters…',
    charactersFailed: 'Could not load the characters: {message}',
    noPlayable: 'This world has no playable characters, so a session cannot be started.',
    start: 'Start',
    starting: 'Starting…',
    cancel: 'Cancel',
    close: 'Close',
    startFailed: 'Could not start the session: {message}',
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
    play: '开始新存档',
    chatNotOpened: '已开始存档“{name}”，但无法打开对话：{message}',
    advanced: '高级设置',
    advancedHelp: '从第一条消息起就按这些设置运行，之后可在对话的“对话设置”页中修改。',
    startTitle: '开始新存档',
    sessionName: '存档名称',
    playAs: '扮演角色',
    loadingCharacters: '正在加载角色…',
    charactersFailed: '无法加载角色：{message}',
    noPlayable: '这张世界卡没有可扮演的角色，无法开始存档。',
    start: '开始',
    starting: '正在开始…',
    cancel: '取消',
    close: '关闭',
    startFailed: '无法开始存档：{message}',
  },
}

export const dictionaries = withDictionaries(own, form)
