import { withDictionaries, type Dictionaries } from '../../i18n.ts'
import { dictionaries as form, type SettingsFormKey } from '../../settings-form/locales.ts'
import { dictionaries as importCard, type ImportCardKey } from '../../widgets/import-card/locales.ts'
import { dictionaries as selection, type ImportSelectionKey } from '../../widgets/import-selection/locales.ts'
import { dictionaries as editor, type WorldLocaleKey } from '../../world-editor/locales.ts'

export type WorldsLocaleKey =
  | SettingsFormKey | WorldLocaleKey | ImportSelectionKey | ImportCardKey | 'advanced' | 'advancedHelp' | 'worldMissing' | 'importCard' | 'importUploading' | 'importUploadFailed' | 'importTags' | 'importNotStarted'
  | 'nav' | 'loading' | 'loadFailed' | 'empty' | 'starterAdd' | 'starterAdding' | 'starterFailed'
  | 'countOne' | 'countOther'
  | 'refresh' | 'refreshing'
  | 'previousPage' | 'nextPage' | 'pageOf'
  | 'problems'
  | 'play' | 'openWorld' | 'chatNotOpened'
  | 'language' | 'startTitle' | 'sessionName' | 'playAs' | 'startOpening' | 'startOpeningDefault' | 'startTime' | 'startTimeHelp' | 'startLorebooks' | 'startLorebookEntry' | 'startLorebookBroken' | 'startLorebookSuggested' | 'startLorebookMissing' | 'startLorebooksHelp' | 'startPreset' | 'startPresetDefault' | 'startPresetWorld' | 'startPresetNone' | 'startPresetBroken' | 'startPresetHelp' | 'loadingCharacters' | 'charactersFailed' | 'noPlayable'
  | 'start' | 'starting' | 'cancel' | 'close' | 'startFailed'
  | 'createWorld' | 'creatingWorld' | 'createWorldTitle' | 'createWorldHelp' | 'worldFolder' | 'worldFolderHelp' | 'worldName' | 'createWorldFailed' | 'worldPreset' | 'worldPresetNone' | 'worldPresetHelp'
  | 'updateFromCard' | 'updateReading' | 'updateNotFromCard' | 'revertUpdate' | 'revertTitle' | 'revertHelp' | 'revertConfirm' | 'reverting' | 'revertFailed' | 'revertDone'
  | 'importPreset' | 'presetReading' | 'presetFailed' | 'presetNotStarted' | 'presetVerbatim' | 'presetVerbatimReplaced'
  | 'authorWorld' | 'openingAuthor' | 'authorWorldFailed' | 'authoringChatTitle'
  | 'translateWarning' | 'translateAction' | 'translateOpening' | 'translateChatTitle' | 'translateFailed' | 'translateNotStarted' | 'languageEnglish' | 'languageChinese' | 'startLanguageNote'
  | 'addAvatars' | 'addAvatarsTitle' | 'addAvatarsHelp' | 'addAvatarsNone' | 'addAvatarsAdding' | 'addAvatarsFailed' | 'addAvatarsLoadFailed' | 'startAvatars' | 'startAvatarsHelp'

const own: Dictionaries<Exclude<WorldsLocaleKey, SettingsFormKey | WorldLocaleKey | ImportSelectionKey | ImportCardKey>> = {
  en: {
    nav: 'Worlds',
    loading: 'Loading worlds…',
    loadFailed: 'Could not load worlds: {message}',
    starterAdd: 'Add this sample world', starterAdding: 'Adding…', starterFailed: 'Could not add the sample world: {message}',
    empty: 'No worlds yet. Create one here, or put a folder with a world.json inside {directory}.',
    countOne: '{count} world',
    countOther: '{count} worlds',
    refresh: 'Refresh',
    refreshing: 'Refreshing…',
    previousPage: 'Previous page',
    nextPage: 'Next page',
    pageOf: 'Page {page} of {pages}',
    problems: '{count} problem(s) found while reading worlds',
    play: 'Start a new session',
    openWorld: 'Edit {name}',
    worldMissing: 'This world is no longer there.',
    importCard: 'Import card', importUploading: 'Reading the card…', importUploadFailed: 'Could not read the card: {message}',
    importTags: 'Tags',
    importNotStarted: 'The world was made, but the import has not started: open its authoring chat and send the /import-st command yourself.',
    chatNotOpened: 'Started the session "{name}", but could not open its chat: {message}',
    advanced: 'Advanced settings',
    advancedHelp: 'These are used from the first message. You can change them later in the chat\'s settings tab.',
    startTitle: 'Start a new session',
    sessionName: 'Session name',
    playAs: 'Play as',
    startLorebooks: 'Lorebooks', startLorebookEntry: '{name} ({count} entries)', startLorebookBroken: '{name} (has problems)', startLorebookSuggested: 'suggested by the world', startLorebookMissing: 'The world suggests the lorebook "{name}", which is not in your library.', startLorebooksHelp: 'The entries of the lorebooks you tick are copied into the story. Entries known to everyone are known to every character.',
    startPreset: 'Writing preset', startPresetDefault: 'Default style', startPresetWorld: 'The world\'s suggestion ({name})', startPresetNone: 'No preset', startPresetBroken: '{name} (has problems)', startPresetHelp: 'A preset sets how the story is written. Presets are kept in the presets folder of your roleplay folder.',
    startOpening: 'Opening', startOpeningDefault: 'The world\'s own opening', startTime: 'Story starts at', startTimeHelp: 'Local time in {zone}, like 1912-04-14T23:40:00. Leave empty for the world\'s own start. Not used when the story follows the real clock.',
    loadingCharacters: 'Loading characters…',
    charactersFailed: 'Could not load the characters: {message}',
    noPlayable: 'This world has no playable characters, so a session cannot be started.',
    start: 'Start',
    starting: 'Starting…',
    cancel: 'Cancel',
    close: 'Close',
    startFailed: 'Could not start the session: {message}',
    createWorld: 'Create world', creatingWorld: 'Creating…', createWorldTitle: 'Create a world', createWorldHelp: 'This creates a minimal world and opens it in the editor. Add characters, places and everything else there.', worldFolder: 'Folder name', worldFolderHelp: 'A new folder directly inside the roleplay worlds directory.', worldName: 'World name', worldPreset: 'Suggested preset', worldPresetNone: 'None', worldPresetHelp: 'Writing instructions from your library for new stories of this world. It can be changed later in the editor.', createWorldFailed: 'Could not create the world: {message}',
    updateFromCard: 'Update from card', updateReading: 'Reading the card…', updateNotFromCard: 'This world was not made from a character card, so a card cannot update it.',
    revertUpdate: 'Undo card update', revertTitle: 'Undo the last card update?', revertHelp: 'The world goes back to how it was before the update, including the card it was made from. What it holds now is kept in the world\'s .trash folder, so changes you made since can still be found. Pictures are not part of this.', revertConfirm: 'Undo the update', reverting: 'Undoing…', revertFailed: 'Could not undo the update: {message}', revertDone: 'The world is back to how it was before the update. What it held is in {folder}.',
    importPreset: 'Import narration preset', presetVerbatim: 'Put the chosen prompts of "{name}" into the world as its narration style, word for word. Check them in the Prompts section.', presetVerbatimReplaced: 'Put the chosen prompts of "{name}" into the world as its narration style, word for word. The style it had before is in the world\'s trash folder. Check the new one in the Prompts section.', presetReading: 'Reading…', presetFailed: 'Could not import the preset: {message}', presetNotStarted: 'The authoring chat opened but the preset was not applied: {message}. Ask it to apply the preset you uploaded.',
    authorWorld: 'Author with AI', openingAuthor: 'Opening…', authorWorldFailed: 'Could not open the authoring chat: {message}', authoringChatTitle: 'Authoring {name}',
    translateWarning: 'This world is written in {from}, but you use {to}. Names, descriptions and the characters\' speech may mix the two languages.', translateAction: 'Translate into {to}', translateOpening: 'Opening…', translateChatTitle: 'Translating {name}', translateFailed: 'Could not start the translation: {message}', translateNotStarted: 'The authoring chat opened but the translation did not start: {message}. Ask it to translate the world.', languageEnglish: 'English', languageChinese: 'Chinese', startLanguageNote: 'This world is written in {from}, but the story will be played in {to}: names and descriptions stay in {from}. A translated copy can be made from the world\'s editor.',
    addAvatars: 'Add avatars', addAvatarsTitle: 'Add avatars to the world', addAvatarsHelp: 'Each avatar you tick becomes a playable character of this world, with its own copy of everything. It starts where the world\'s playable characters start.', addAvatarsNone: 'There are no avatars yet. Make some on the Avatars tab.', addAvatarsAdding: 'Adding…', addAvatarsFailed: 'Could not add the avatars: {message}', addAvatarsLoadFailed: 'Could not load the avatars: {message}', startAvatars: 'Bring avatars', startAvatarsHelp: 'Tick the avatars to bring into this session as characters; you can play them too. The world itself is not changed.',
  },
  zh: {
    nav: '世界卡',
    loading: '正在加载世界卡…',
    loadFailed: '无法加载世界卡：{message}',
    starterAdd: '添加这个示例世界', starterAdding: '正在添加…', starterFailed: '无法添加示例世界：{message}',
    empty: '还没有世界卡。可在此创建，也可在 {directory} 中新建文件夹并放入 world.json。',
    countOne: '{count} 张世界卡',
    countOther: '{count} 张世界卡',
    refresh: '刷新',
    refreshing: '刷新中…',
    previousPage: '上一页',
    nextPage: '下一页',
    pageOf: '第 {page} 页，共 {pages} 页',
    problems: '读取世界卡时发现 {count} 个问题',
    play: '开始新存档',
    openWorld: '编辑{name}',
    worldMissing: '这个世界已经不存在了。',
    importCard: '导入角色卡', importUploading: '正在读取角色卡…', importUploadFailed: '无法读取角色卡：{message}',
    importTags: '标签',
    importNotStarted: '世界已创建，但导入尚未开始：请打开它的编辑对话，并自行发送 /import-st 指令。',
    chatNotOpened: '已开始存档“{name}”，但无法打开对话：{message}',
    advanced: '高级设置',
    advancedHelp: '从第一条消息起就按这些设置运行，之后可在对话的“对话设置”页中修改。',
    startTitle: '开始新存档',
    sessionName: '存档名称',
    playAs: '扮演角色',
    startLorebooks: '世界书', startLorebookEntry: '{name}（{count} 个条目）', startLorebookBroken: '{name}（有问题）', startLorebookSuggested: '世界建议', startLorebookMissing: '世界建议使用世界书“{name}”，但你的资料库里没有。', startLorebooksHelp: '勾选的世界书的条目会复制进故事。人人皆知的条目，每个角色都知道。',
    startPreset: '写作预设', startPresetDefault: '默认风格', startPresetWorld: '世界的建议（{name}）', startPresetNone: '不使用预设', startPresetBroken: '{name}（有问题）', startPresetHelp: '预设决定故事的写法。预设保存在角色扮演文件夹的 presets 文件夹中。',
    startOpening: '开场', startOpeningDefault: '世界自带的开场', startTime: '故事开始于', startTimeHelp: '{zone} 的本地时间，例如 1912-04-14T23:40:00。留空则使用世界自带的开始时间。故事跟随真实时钟时不适用。',
    loadingCharacters: '正在加载角色…',
    charactersFailed: '无法加载角色：{message}',
    noPlayable: '这张世界卡没有可扮演的角色，无法开始存档。',
    start: '开始',
    starting: '正在开始…',
    cancel: '取消',
    close: '关闭',
    startFailed: '无法开始存档：{message}',
    createWorld: '创建世界', creatingWorld: '正在创建…', createWorldTitle: '创建世界', createWorldHelp: '系统会创建一个最小世界并直接在编辑器中打开；角色、地点等内容可随后添加。', worldFolder: '文件夹名称', worldFolderHelp: '将在角色扮演 worlds 目录下直接创建这个文件夹。', worldName: '世界名称', worldPreset: '建议的预设', worldPresetNone: '无', worldPresetHelp: '库中的写作指令，供这个世界的新故事使用；之后可在编辑器中修改。', createWorldFailed: '无法创建世界：{message}',
    updateFromCard: '用角色卡更新', updateReading: '正在读取角色卡…', updateNotFromCard: '这个世界不是由角色卡导入的，无法用角色卡更新。',
    revertUpdate: '撤销卡片更新', revertTitle: '撤销上一次卡片更新？', revertHelp: '世界会回到更新之前的样子，包括它所依据的角色卡。现在的内容会保存在世界的 .trash 文件夹里，之后做的修改仍然可以找回。图片不在撤销范围内。', revertConfirm: '撤销更新', reverting: '正在撤销…', revertFailed: '无法撤销更新：{message}', revertDone: '世界已回到更新之前的样子。原来的内容保存在 {folder}。',
    importPreset: '导入叙述预设', presetVerbatim: '已将“{name}”所选提示原文放入世界，作为它的叙述风格。请在“提示词”部分检查。', presetVerbatimReplaced: '已将“{name}”所选提示原文放入世界，作为它的叙述风格。原来的风格保存在世界的回收文件夹里。请在“提示词”部分检查新的风格。', presetReading: '正在读取…', presetFailed: '无法导入预设：{message}', presetNotStarted: '世界编辑对话已打开，但预设没有应用：{message}。可以请它应用你上传的预设。',
    authorWorld: '使用 AI 编辑', openingAuthor: '正在打开…', authorWorldFailed: '无法打开世界编辑对话：{message}', authoringChatTitle: '编辑{name}',
    translateWarning: '这个世界是用{from}写的，而你使用的是{to}。名字、描述和角色的说话可能会两种语言混在一起。', translateAction: '翻译成{to}', translateOpening: '正在打开…', translateChatTitle: '翻译{name}', translateFailed: '无法开始翻译：{message}', translateNotStarted: '世界编辑对话已打开，但翻译没有开始：{message}。可以请它翻译这个世界。', languageEnglish: '英文', languageChinese: '中文', startLanguageNote: '这个世界是用{from}写的，而故事将用{to}进行：名字和描述仍是{from}。可以在世界编辑器里生成一个翻译后的副本。',
    addAvatars: '添加角色形象', addAvatarsTitle: '把角色形象加入世界', addAvatarsHelp: '勾选的每个角色形象都会成为这个世界的可扮演角色，并带有自己的一份副本。它们从世界中可扮演角色的起始位置出发。', addAvatarsNone: '还没有角色形象。请先到“角色形象”标签页创建。', addAvatarsAdding: '正在添加…', addAvatarsFailed: '无法添加角色形象：{message}', addAvatarsLoadFailed: '无法加载角色形象：{message}', startAvatars: '带上角色形象', startAvatarsHelp: '勾选要带进这个存档的角色形象，它们会成为存档中的角色，你也可以扮演它们。世界本身不会改变。',
  },
}

export const dictionaries = withDictionaries(withDictionaries(withDictionaries(withDictionaries(own, form), editor), selection), importCard)
