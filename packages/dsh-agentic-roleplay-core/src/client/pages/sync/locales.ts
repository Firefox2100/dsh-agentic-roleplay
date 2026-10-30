import type { Dictionaries } from '../../i18n.ts'

export type SyncLocaleKey =
  | 'nav' | 'loading' | 'loadFailed' | 'refresh' | 'run' | 'running' | 'runOne' | 'never' | 'lastRun' | 'dateLocale' | 'empty' | 'problem' | 'failed'
  | 'unit' | 'kind' | 'state' | 'synced' | 'details' | 'actions' | 'tableCaption'
  | 'kind_world' | 'kind_session' | 'kind_shared'
  | 'state_synced' | 'state_changed' | 'state_new' | 'state_conflict' | 'state_busy' | 'state_failed' | 'state_ignored'
  | 'ignoredDetail' | 'restore' | 'removedDetail' | 'deleteEverywhere' | 'keepOnRemote' | 'getBack' | 'deletedDetail' | 'keepMine' | 'deleteHere'
  | 'conflictWhole' | 'conflictFiles' | 'keepLocal' | 'keepRemote'
  | 'confirmEverywhereTitle' | 'confirmEverywhere' | 'confirmHereTitle' | 'confirmHere' | 'cancel' | 'close'

export const dictionaries: Dictionaries<SyncLocaleKey> = {
  en: {
    nav: 'Sync', loading: 'Reading the sync state…', loadFailed: 'Could not read the sync state: {message}', refresh: 'Refresh',
    run: 'Sync now', running: 'Syncing…', runOne: 'Sync', never: 'never', lastRun: 'Last run: {when}',
    dateLocale: 'en-GB',
    empty: 'Nothing to sync yet. Worlds, sessions and the shared folders (prompts, presets, lorebooks, avatars, interface packs) appear here once there are some.',
    problem: 'Sync cannot run: {message}. Set it up in Settings, under Role Play.', failed: 'The last action failed: {message}',
    unit: 'Unit', kind: 'Kind', state: 'State', synced: 'Last synced', details: 'Details', actions: 'Actions', tableCaption: 'Roleplay content sync status',
    kind_world: 'World', kind_session: 'Session', kind_shared: 'Shared folder',
    state_synced: 'In step', state_changed: 'Changed here', state_new: 'Not synced yet', state_conflict: 'Needs a choice', state_busy: 'Syncing', state_failed: 'Failed', state_ignored: 'Kept on the remote',
    conflictWhole: 'Both sides changed this. Keep one: the other is replaced.',
    conflictFiles: 'Both sides changed these files, so both copies were kept side by side: {files}. Choose which copy to keep.',
    keepLocal: 'Keep this device\'s', keepRemote: 'Keep the remote\'s',
    ignoredDetail: 'Deleted here only. The remote still has it and it is not synced back.', restore: 'Sync it again',
    removedDetail: 'This was removed on this device, and the remote still has it. Delete it everywhere, keep it on the remote and stop syncing it here, or get it back.',
    deleteEverywhere: 'Delete everywhere', keepOnRemote: 'Keep on the remote', getBack: 'Get it back',
    deletedDetail: 'Another device deleted this, but it was changed here since, so it was not removed. Keep this copy and sync it again, or delete it here too.',
    keepMine: 'Keep this copy', deleteHere: 'Delete it here too',
    confirmEverywhereTitle: 'Delete synced content everywhere?',
    confirmEverywhere: 'Delete "{unit}" from this device and the remote? Other devices will delete their copies when they next sync.',
    confirmHereTitle: 'Delete this device\'s copy?',
    confirmHere: 'Delete "{unit}" from this device too? This matches the deletion already recorded on the remote.',
    cancel: 'Cancel', close: 'Close',
  },
  zh: {
    nav: '同步', loading: '正在读取同步状态…', loadFailed: '无法读取同步状态：{message}', refresh: '刷新',
    run: '立即同步', running: '同步中…', runOne: '同步', never: '从未', lastRun: '上次运行：{when}',
    dateLocale: 'zh-CN',
    empty: '还没有可同步的内容。世界、会话和共享文件夹（提示词、预设、世界书、头像、界面包）一旦有内容就会出现在这里。',
    problem: '无法同步：{message}。请在“设置”的“角色扮演”中配置。', failed: '上一次操作失败：{message}',
    unit: '单元', kind: '类型', state: '状态', synced: '上次同步', details: '详情', actions: '操作', tableCaption: '角色扮演内容同步状态',
    kind_world: '世界', kind_session: '会话', kind_shared: '共享文件夹',
    state_synced: '已一致', state_changed: '本机已改动', state_new: '尚未同步', state_conflict: '需要选择', state_busy: '同步中', state_failed: '失败', state_ignored: '仅保留在远端',
    conflictWhole: '两边都改动了它。请保留其中一份，另一份会被替换。',
    conflictFiles: '两边都改动了这些文件，所以两份都保留了下来：{files}。请选择保留哪一份。',
    keepLocal: '保留本机的', keepRemote: '保留远端的',
    ignoredDetail: '只在本机删除了。远端仍有它，且不会同步回来。', restore: '重新同步',
    removedDetail: '它在本机被移除了，远端仍有它。可以在所有设备上删除，也可以保留在远端并停止在本机同步，或把它取回来。',
    deleteEverywhere: '在所有设备上删除', keepOnRemote: '保留在远端', getBack: '取回',
    deletedDetail: '另一台设备删除了它，但本机之后又改动过，所以没有移除。可以保留这一份并重新同步，也可以在本机一并删除。',
    keepMine: '保留这一份', deleteHere: '在本机一并删除',
    confirmEverywhereTitle: '在所有设备上删除同步内容？',
    confirmEverywhere: '要从本机和远端删除“{unit}”吗？其他设备下次同步时也会删除各自的副本。',
    confirmHereTitle: '删除本机副本？',
    confirmHere: '也要从本机删除“{unit}”吗？这会与远端已经记录的删除保持一致。',
    cancel: '取消', close: '关闭',
  },
}
