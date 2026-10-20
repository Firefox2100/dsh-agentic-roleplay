import type { Dictionaries } from '../../i18n.ts'

export type PresetsLocaleKey =
  | 'nav' | 'language' | 'loading' | 'loadFailed' | 'empty' | 'countOne' | 'countOther' | 'refresh' | 'refreshing' | 'back' | 'cancel' | 'close'
  | 'create' | 'createTitle' | 'createHelp' | 'presetName' | 'presetNameHelp' | 'presetTitle' | 'presetDescription' | 'creating' | 'createFailed'
  | 'import' | 'importTitle' | 'importHelp' | 'importing' | 'importFailed' | 'importNotStarted'
  | 'edit' | 'author' | 'authorFailed' | 'delete' | 'deleteTitle' | 'deleteHelp' | 'deleting' | 'deleteFailed'
  | 'broken' | 'languages' | 'promptsCount'
  | 'info' | 'infoSave' | 'infoSaving' | 'infoSaved' | 'infoFailed' | 'samplingMaster' | 'samplingCharacters' | 'samplingHelp'
  | 'prompts' | 'promptsHelp' | 'promptsNone' | 'promptPick' | 'promptSave' | 'promptSaving' | 'promptSaved' | 'promptRemove' | 'promptFailed' | 'promptReset' | 'missing' | 'promptAdd' | 'promptAddButton'
  | 'prompt_roleplay/persona' | 'prompt_roleplay/style' | 'prompt_roleplay/character-style'

export const dictionaries: Dictionaries<PresetsLocaleKey> = {
  en: {
    nav: 'Presets', language: 'en', loading: 'Loading presets…', loadFailed: 'Could not load the presets: {message}',
    empty: 'No presets yet. A preset is a set of writing instructions (the narrator, the narration style, how characters speak) that you can put into any story. Make one to edit, import a SillyTavern preset, or save a world\'s own prompts as one.',
    countOne: '{count} preset', countOther: '{count} presets', refresh: 'Refresh', refreshing: 'Refreshing…', back: 'Back', cancel: 'Cancel', close: 'Close',
    create: 'New preset', createTitle: 'New preset', createHelp: 'The new preset starts with the shipped narration prompts, which you can then rewrite yourself or with the assistant.',
    presetName: 'Name', presetNameHelp: 'Letters, digits, "-" and "_", up to 64. Worlds and sessions refer to the preset by this name.', presetTitle: 'Title', presetDescription: 'Description', creating: 'Creating…', createFailed: 'Could not create the preset: {message}',
    import: 'Import SillyTavern preset', importTitle: 'Import a SillyTavern preset', importHelp: 'The assistant reads {file} and writes the parts that are about how to narrate into a new preset: the narrator, the style, how characters speak. Rules of the game, formats and scripts are not carried over.', importing: 'Importing…', importFailed: 'Could not import the preset: {message}', importNotStarted: 'The preset was kept, but the assistant could not be started: {message}. Open its authoring chat to continue.',
    edit: 'Edit', author: 'Edit with assistant', authorFailed: 'Could not open the authoring chat: {message}', delete: 'Delete', deleteTitle: 'Delete preset', deleteHelp: 'Delete {name}? Stories that already use it keep their own copy. The preset is moved to the trash folder.', deleting: 'Deleting…', deleteFailed: 'Could not delete the preset: {message}',
    broken: 'Cannot be used: {problems}', languages: 'Languages: {list}', promptsCount: '{count} prompts',
    info: 'About', infoSave: 'Save', infoSaving: 'Saving…', infoSaved: 'Saved.', infoFailed: 'Could not save: {message}', samplingMaster: 'Narrator temperature', samplingCharacters: 'Characters temperature', samplingHelp: 'Suggested only: a story\'s own settings win. Leave empty to suggest nothing; 0 to 2.',
    prompts: 'Prompts', promptsHelp: 'The text a story gets when it starts with this preset. ${name} marks a value the program fills in. A prompt or language the preset lacks can be added below; the assistant can also write it.', promptsNone: 'This preset carries no prompts yet.', promptPick: 'Prompt', promptSave: 'Save prompt', promptSaving: 'Saving…', promptSaved: 'Saved.', promptRemove: 'Remove this prompt', promptFailed: 'Could not save the prompt: {message}', promptReset: 'Discard changes', missing: 'This preset is no longer there.', promptAdd: 'Add a prompt…', promptAddButton: 'Add',
    'prompt_roleplay/persona': 'Persona', 'prompt_roleplay/style': 'Narration style', 'prompt_roleplay/character-style': 'Character style',
  },
  zh: {
    nav: '预设', language: 'zh', loading: '正在加载预设…', loadFailed: '无法加载预设：{message}',
    empty: '还没有预设。预设是一组可放进任何故事的写作指令（叙述者、叙述文风、角色怎样说话）。你可以新建一个来编辑，导入酒馆预设，或把世界自带的提示词存成预设。',
    countOne: '{count} 个预设', countOther: '{count} 个预设', refresh: '刷新', refreshing: '正在刷新…', back: '返回', cancel: '取消', close: '关闭',
    create: '新建预设', createTitle: '新建预设', createHelp: '新预设以内置的叙述提示词为起点，之后可以自己改写，也可以交给助手改写。',
    presetName: '名称', presetNameHelp: '字母、数字、“-”和“_”，最长 64 个字符。世界和存档通过这个名称引用预设。', presetTitle: '标题', presetDescription: '描述', creating: '正在创建…', createFailed: '无法创建预设：{message}',
    import: '导入酒馆预设', importTitle: '导入酒馆预设', importHelp: '助手会读取 {file}，把其中关于叙述方式的部分（叙述者、文风、角色说话方式）写进一个新预设；游戏规则、格式和脚本不会被带入。', importing: '正在导入…', importFailed: '无法导入预设：{message}', importNotStarted: '预设已保存，但助手没能启动：{message}。请打开它的创作聊天继续。',
    edit: '编辑', author: '用助手编辑', authorFailed: '无法打开创作聊天：{message}', delete: '删除', deleteTitle: '删除预设', deleteHelp: '删除{name}？已经在使用它的故事会保留各自的副本。该预设会被移到回收文件夹。', deleting: '正在删除…', deleteFailed: '无法删除预设：{message}',
    broken: '无法使用：{problems}', languages: '语言：{list}', promptsCount: '{count} 个提示词',
    info: '概览', infoSave: '保存', infoSaving: '正在保存…', infoSaved: '已保存。', infoFailed: '无法保存：{message}', samplingMaster: '叙述者温度', samplingCharacters: '角色温度', samplingHelp: '仅作建议：故事自己的设置优先。留空表示不建议；范围 0 到 2。',
    prompts: '提示词', promptsHelp: '以这个预设开始的故事会得到这些文字。${name} 表示由程序填入的值。预设缺少的提示词或语言可以在下面添加，也可以让助手来写。', promptsNone: '这个预设还没有提示词。', promptPick: '提示词', promptSave: '保存提示词', promptSaving: '正在保存…', promptSaved: '已保存。', promptRemove: '移除此提示词', promptFailed: '无法保存提示词：{message}', promptReset: '放弃修改', missing: '这个预设已不存在。', promptAdd: '添加提示词…', promptAddButton: '添加',
    'prompt_roleplay/persona': '人设', 'prompt_roleplay/style': '叙述文风', 'prompt_roleplay/character-style': '角色风格',
  },
}
