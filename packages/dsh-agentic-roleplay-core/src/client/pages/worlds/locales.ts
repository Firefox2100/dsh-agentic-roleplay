import { withDictionaries, type Dictionaries } from '../../i18n.ts'
import { dictionaries as form, type SettingsFormKey } from '../../settings-form/locales.ts'
import { dictionaries as editor, type WorldLocaleKey } from '../../world-editor/locales.ts'

export type WorldsLocaleKey =
  | SettingsFormKey | WorldLocaleKey | 'advanced' | 'advancedHelp' | 'worldMissing' | 'importCard' | 'importUploading' | 'importUploadFailed' | 'importTitle' | 'importSource' | 'importWorldName' | 'importNoPicture' | 'importTags' | 'importCreator' | 'importFields' | 'importFieldDescription' | 'importFieldPersonality' | 'importFieldScenario' | 'importFieldExamples' | 'importFieldNotes' | 'importFieldInstructions' | 'importNotCarried' | 'importOpening' | 'importOpeningHelp' | 'importOpeningFirst' | 'importOpeningAlternate' | 'importOpeningNone' | 'importLorebook' | 'importLorebookHelp' | 'importEntryCount' | 'importEnableAll' | 'importDisableAll' | 'importConstant' | 'importKeys' | 'importNoKeys' | 'importScripts' | 'importStart' | 'importStarting' | 'importStartFailed' | 'importCancel' | 'importEmpty' | 'importNotStarted'
  | 'nav' | 'loading' | 'loadFailed' | 'empty' | 'starterAdd' | 'starterAdding' | 'starterFailed'
  | 'countOne' | 'countOther'
  | 'refresh' | 'refreshing'
  | 'previousPage' | 'nextPage' | 'pageOf'
  | 'problems'
  | 'play' | 'openWorld' | 'chatNotOpened'
  | 'language' | 'startTitle' | 'sessionName' | 'playAs' | 'startOpening' | 'startOpeningDefault' | 'startTime' | 'startTimeHelp' | 'loadingCharacters' | 'charactersFailed' | 'noPlayable'
  | 'start' | 'starting' | 'cancel' | 'close' | 'startFailed'
  | 'createWorld' | 'creatingWorld' | 'createWorldTitle' | 'createWorldHelp' | 'worldFolder' | 'worldFolderHelp' | 'worldName' | 'createWorldFailed'
  | 'authorWorld' | 'openingAuthor' | 'authorWorldFailed' | 'authoringChatTitle'
  | 'translateWarning' | 'translateAction' | 'translateOpening' | 'translateChatTitle' | 'translateFailed' | 'translateNotStarted' | 'languageEnglish' | 'languageChinese' | 'startLanguageNote'
  | 'addAvatars' | 'addAvatarsTitle' | 'addAvatarsHelp' | 'addAvatarsNone' | 'addAvatarsAdding' | 'addAvatarsFailed' | 'addAvatarsLoadFailed' | 'startAvatars' | 'startAvatarsHelp'

const own: Dictionaries<Exclude<WorldsLocaleKey, SettingsFormKey | WorldLocaleKey>> = {
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
    importCard: 'Import card', importUploading: 'Reading the card…', importUploadFailed: 'Could not read the card: {message}', importTitle: 'Import a character card',
    importSource: 'A {spec} card{converted}.', importWorldName: 'Name of the new world', importNoPicture: 'No picture', importTags: 'Tags', importCreator: 'Made by',
    importFields: 'What the card says', importFieldDescription: 'Description', importFieldPersonality: 'Personality', importFieldScenario: 'Scenario', importFieldExamples: 'Example messages', importFieldNotes: "Creator's notes",
    importFieldInstructions: 'Instructions to the AI', importNotCarried: 'Only guidance on style and behaviour is imported (as the world\'s prose prompts); rules for running the chat are not.',
    importOpening: 'Opening', importOpeningHelp: 'The new world starts with one opening. Choose which of the card\'s greetings it is.', importOpeningFirst: 'First message', importOpeningAlternate: 'Alternate greeting {number}', importOpeningNone: 'No opening',
    importLorebook: 'Lorebook', importLorebookHelp: 'Entries that are switched off are not read at all. Every other entry is read for what it is about: characters, places, background and so on.',
    importEntryCount: '{on} of {total} entries on', importEnableAll: 'Switch all on', importDisableAll: 'Switch all off', importConstant: 'always on', importKeys: 'Keys: {keys}', importNoKeys: 'No keys',
    importScripts: '{count} scripts and settings of the tool that made the card are not imported.', importStart: 'Import', importStarting: 'Starting…', importStartFailed: 'Could not start the import: {message}', importCancel: 'Cancel', importEmpty: '(empty)', importNotStarted: 'The world was made, but the import has not started: open its authoring chat and send the /import-st command yourself.',
    chatNotOpened: 'Started the session "{name}", but could not open its chat: {message}',
    advanced: 'Advanced settings',
    advancedHelp: 'These are used from the first message. You can change them later in the chat\'s settings tab.',
    startTitle: 'Start a new session',
    sessionName: 'Session name',
    playAs: 'Play as',
    startOpening: 'Opening', startOpeningDefault: 'The world\'s own opening', startTime: 'Story starts at', startTimeHelp: 'Local time in {zone}, like 1912-04-14T23:40:00. Leave empty for the world\'s own start. Not used when the story follows the real clock.',
    loadingCharacters: 'Loading characters…',
    charactersFailed: 'Could not load the characters: {message}',
    noPlayable: 'This world has no playable characters, so a session cannot be started.',
    start: 'Start',
    starting: 'Starting…',
    cancel: 'Cancel',
    close: 'Close',
    startFailed: 'Could not start the session: {message}',
    createWorld: 'Create world', creatingWorld: 'Creating…', createWorldTitle: 'Create a world', createWorldHelp: 'This creates a minimal world and opens it in the editor. Add characters, places and everything else there.', worldFolder: 'Folder name', worldFolderHelp: 'A new folder directly inside the roleplay worlds directory.', worldName: 'World name', createWorldFailed: 'Could not create the world: {message}',
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
    importCard: '导入角色卡', importUploading: '正在读取角色卡…', importUploadFailed: '无法读取角色卡：{message}', importTitle: '导入角色卡',
    importSource: '{spec} 角色卡{converted}。', importWorldName: '新世界的名称', importNoPicture: '没有图片', importTags: '标签', importCreator: '作者',
    importFields: '角色卡的内容', importFieldDescription: '描述', importFieldPersonality: '性格', importFieldScenario: '场景', importFieldExamples: '对话示例', importFieldNotes: '作者备注',
    importFieldInstructions: '给 AI 的指令', importNotCarried: '只导入关于文风和角色表现的指导（作为世界的文笔提示）；运行聊天的规则不会导入。',
    importOpening: '开场白', importOpeningHelp: '新世界只有一个开场白。请选择使用角色卡中的哪一条问候语。', importOpeningFirst: '第一条消息', importOpeningAlternate: '备选问候语 {number}', importOpeningNone: '不要开场白',
    importLorebook: '世界书', importLorebookHelp: '关闭的条目完全不会被读取。其余条目会按其内容（角色、地点、背景等）分别读取。',
    importEntryCount: '已开启 {on} / {total} 条', importEnableAll: '全部开启', importDisableAll: '全部关闭', importConstant: '常驻', importKeys: '关键词：{keys}', importNoKeys: '无关键词',
    importScripts: '制作角色卡的工具的 {count} 个脚本和设置不会导入。', importStart: '导入', importStarting: '正在开始…', importStartFailed: '无法开始导入：{message}', importCancel: '取消', importEmpty: '（空）', importNotStarted: '世界已创建，但导入尚未开始：请打开它的编辑对话，并自行发送 /import-st 指令。',
    chatNotOpened: '已开始存档“{name}”，但无法打开对话：{message}',
    advanced: '高级设置',
    advancedHelp: '从第一条消息起就按这些设置运行，之后可在对话的“对话设置”页中修改。',
    startTitle: '开始新存档',
    sessionName: '存档名称',
    playAs: '扮演角色',
    startOpening: '开场', startOpeningDefault: '世界自带的开场', startTime: '故事开始于', startTimeHelp: '{zone} 的本地时间，例如 1912-04-14T23:40:00。留空则使用世界自带的开始时间。故事跟随真实时钟时不适用。',
    loadingCharacters: '正在加载角色…',
    charactersFailed: '无法加载角色：{message}',
    noPlayable: '这张世界卡没有可扮演的角色，无法开始存档。',
    start: '开始',
    starting: '正在开始…',
    cancel: '取消',
    close: '关闭',
    startFailed: '无法开始存档：{message}',
    createWorld: '创建世界', creatingWorld: '正在创建…', createWorldTitle: '创建世界', createWorldHelp: '系统会创建一个最小世界并直接在编辑器中打开；角色、地点等内容可随后添加。', worldFolder: '文件夹名称', worldFolderHelp: '将在角色扮演 worlds 目录下直接创建这个文件夹。', worldName: '世界名称', createWorldFailed: '无法创建世界：{message}',
    authorWorld: '使用 AI 编辑', openingAuthor: '正在打开…', authorWorldFailed: '无法打开世界编辑对话：{message}', authoringChatTitle: '编辑{name}',
    translateWarning: '这个世界是用{from}写的，而你使用的是{to}。名字、描述和角色的说话可能会两种语言混在一起。', translateAction: '翻译成{to}', translateOpening: '正在打开…', translateChatTitle: '翻译{name}', translateFailed: '无法开始翻译：{message}', translateNotStarted: '世界编辑对话已打开，但翻译没有开始：{message}。可以请它翻译这个世界。', languageEnglish: '英文', languageChinese: '中文', startLanguageNote: '这个世界是用{from}写的，而故事将用{to}进行：名字和描述仍是{from}。可以在世界编辑器里生成一个翻译后的副本。',
    addAvatars: '添加角色形象', addAvatarsTitle: '把角色形象加入世界', addAvatarsHelp: '勾选的每个角色形象都会成为这个世界的可扮演角色，并带有自己的一份副本。它们从世界中可扮演角色的起始位置出发。', addAvatarsNone: '还没有角色形象。请先到“角色形象”标签页创建。', addAvatarsAdding: '正在添加…', addAvatarsFailed: '无法添加角色形象：{message}', addAvatarsLoadFailed: '无法加载角色形象：{message}', startAvatars: '带上角色形象', startAvatarsHelp: '勾选要带进这个存档的角色形象，它们会成为存档中的角色，你也可以扮演它们。世界本身不会改变。',
  },
}

export const dictionaries = withDictionaries(withDictionaries(own, form), editor)
