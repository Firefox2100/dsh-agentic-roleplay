import type { Dictionaries } from '../../i18n.ts'

export type LorebooksLocaleKey =
  | 'nav' | 'language' | 'loading' | 'loadFailed' | 'empty' | 'countOne' | 'countOther' | 'refresh' | 'refreshing' | 'back' | 'cancel' | 'close'
  | 'create' | 'createTitle' | 'createHelp' | 'bookName' | 'bookNameHelp' | 'bookTitle' | 'bookDescription' | 'creating' | 'createFailed'
  | 'import' | 'importTitle' | 'importHelp' | 'importing' | 'importFailed' | 'importNotStarted'
  | 'edit' | 'author' | 'authorFailed' | 'delete' | 'deleteTitle' | 'deleteHelp' | 'deleting' | 'deleteFailed'
  | 'broken' | 'entriesCount' | 'commonCount'
  | 'info' | 'infoSave' | 'infoSaving' | 'infoSaved' | 'infoFailed'
  | 'entries' | 'entriesHelp' | 'entryPick' | 'entryNew' | 'entryAdd' | 'entryId' | 'entryTitle' | 'entryKind' | 'entryScope' | 'entryKnownBy' | 'entrySummary' | 'entryBody' | 'entryRelated'
  | 'entrySave' | 'entrySaving' | 'entrySaved' | 'entryRemove' | 'entryFailed'
  | 'scope_everyone' | 'scope_listed'
  | 'kind_history' | 'kind_culture' | 'kind_religion' | 'kind_politics' | 'kind_geography' | 'kind_science' | 'kind_custom' | 'kind_legend' | 'kind_other'

export const dictionaries: Dictionaries<LorebooksLocaleKey> = {
  en: {
    nav: 'Lorebooks', language: 'en', loading: 'Loading lorebooks…', loadFailed: 'Could not load the lorebooks: {message}',
    empty: 'No lorebooks yet. A lorebook is a collection of background knowledge (history, customs, places, legends) that any story can start with. Make one to fill in, or import a SillyTavern lorebook.',
    countOne: '{count} lorebook', countOther: '{count} lorebooks', refresh: 'Refresh', refreshing: 'Refreshing…', back: 'Back', cancel: 'Cancel', close: 'Close',
    create: 'New lorebook', createTitle: 'New lorebook', createHelp: 'The new lorebook starts empty. Add entries yourself or with the assistant.',
    bookName: 'Name', bookNameHelp: 'Letters, digits, "-" and "_", up to 64. Worlds and stories refer to the lorebook by this name.', bookTitle: 'Title', bookDescription: 'Description', creating: 'Creating…', createFailed: 'Could not create the lorebook: {message}',
    import: 'Import SillyTavern lorebook', importTitle: 'Import a SillyTavern lorebook', importHelp: 'The assistant reads {file}. Facts become entries that everyone in a story knows, unless an entry clearly says only some characters do. Instructions to the AI are kept aside, and you are asked before they become a preset.', importing: 'Importing…', importFailed: 'Could not import the lorebook: {message}', importNotStarted: 'The lorebook was kept, but the assistant could not be started: {message}. Open its authoring chat to continue.',
    edit: 'Edit', author: 'Edit with assistant', authorFailed: 'Could not open the authoring chat: {message}', delete: 'Delete', deleteTitle: 'Delete lorebook', deleteHelp: 'Delete {name}? Stories that already use it keep their own copy. The lorebook is moved to the trash folder.', deleting: 'Deleting…', deleteFailed: 'Could not delete the lorebook: {message}',
    broken: 'Cannot be used: {problems}', entriesCount: '{count} entries', commonCount: '{count} known to everyone',
    info: 'About', infoSave: 'Save', infoSaving: 'Saving…', infoSaved: 'Saved.', infoFailed: 'Could not save: {message}',
    entries: 'Entries', entriesHelp: 'One fact of the world each, written as reference prose. A story starts with every entry; entries known to everyone are known to every character, and the others only to the characters listed.',
    entryPick: 'Entry', entryNew: 'New entry', entryAdd: 'New entry', entryId: 'Id', entryTitle: 'Title', entryKind: 'Kind', entryScope: 'Who knows it', entryKnownBy: 'Known by (names, separated by commas)', entrySummary: 'Summary (one sentence)', entryBody: 'Text', entryRelated: 'Related entries (ids, separated by commas)',
    entrySave: 'Save entry', entrySaving: 'Saving…', entrySaved: 'Saved.', entryRemove: 'Remove this entry', entryFailed: 'Could not save the entry: {message}',
    scope_everyone: 'Everyone', scope_listed: 'Only the characters listed',
    kind_history: 'History', kind_culture: 'Culture', kind_religion: 'Religion', kind_politics: 'Politics', kind_geography: 'Geography', kind_science: 'Science', kind_custom: 'Custom', kind_legend: 'Legend', kind_other: 'Other',
  },
  zh: {
    nav: '世界书', language: 'zh', loading: '正在加载世界书…', loadFailed: '无法加载世界书：{message}',
    empty: '还没有世界书。世界书是任何故事都可以带上的背景知识集合（历史、习俗、地点、传说）。你可以新建一本来填写，或导入酒馆世界书。',
    countOne: '{count} 本世界书', countOther: '{count} 本世界书', refresh: '刷新', refreshing: '正在刷新…', back: '返回', cancel: '取消', close: '关闭',
    create: '新建世界书', createTitle: '新建世界书', createHelp: '新世界书一开始是空的。可以自己添加条目，也可以交给助手。',
    bookName: '名称', bookNameHelp: '字母、数字、“-”和“_”，最长 64 个字符。世界和故事通过这个名称引用世界书。', bookTitle: '标题', bookDescription: '描述', creating: '正在创建…', createFailed: '无法创建世界书：{message}',
    import: '导入酒馆世界书', importTitle: '导入酒馆世界书', importHelp: '助手会读取 {file}。事实会变成故事中人人皆知的条目，除非条目明确说明只有部分角色知道。给 AI 的指令会被单独保存，变成预设之前会先征求你的同意。', importing: '正在导入…', importFailed: '无法导入世界书：{message}', importNotStarted: '世界书已保存，但助手没能启动：{message}。请打开它的创作聊天继续。',
    edit: '编辑', author: '用助手编辑', authorFailed: '无法打开创作聊天：{message}', delete: '删除', deleteTitle: '删除世界书', deleteHelp: '删除{name}？已经在使用它的故事会保留各自的副本。该世界书会被移到回收文件夹。', deleting: '正在删除…', deleteFailed: '无法删除世界书：{message}',
    broken: '无法使用：{problems}', entriesCount: '{count} 个条目', commonCount: '{count} 个人人皆知',
    info: '概览', infoSave: '保存', infoSaving: '正在保存…', infoSaved: '已保存。', infoFailed: '无法保存：{message}',
    entries: '条目', entriesHelp: '每条是世界的一个事实，写成说明性文字。故事开始时会带上每个条目；人人皆知的条目每个角色都知道，其余的只有列出的角色知道。',
    entryPick: '条目', entryNew: '新条目', entryAdd: '新条目', entryId: '编号', entryTitle: '标题', entryKind: '类型', entryScope: '谁知道', entryKnownBy: '知道的人（名字，用逗号分隔）', entrySummary: '摘要（一句话）', entryBody: '正文', entryRelated: '相关条目（编号，用逗号分隔）',
    entrySave: '保存条目', entrySaving: '正在保存…', entrySaved: '已保存。', entryRemove: '移除此条目', entryFailed: '无法保存条目：{message}',
    scope_everyone: '所有人', scope_listed: '仅列出的角色',
    kind_history: '历史', kind_culture: '文化', kind_religion: '宗教', kind_politics: '政治', kind_geography: '地理', kind_science: '科学', kind_custom: '习俗', kind_legend: '传说', kind_other: '其他',
  },
}
