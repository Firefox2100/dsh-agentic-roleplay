import type { Dictionaries } from '../../i18n.ts'

export type ImportSelectionKey =
  | 'is_title_preset' | 'is_title_lorebook' | 'is_help_preset' | 'is_help_lorebook' | 'is_selected' | 'is_all' | 'is_none' | 'is_asFile' | 'is_chars' | 'is_show'
  | 'is_note_prefill' | 'is_note_variables' | 'is_note_always' | 'is_ignored' | 'is_ignored_regexScripts' | 'is_ignored_scripts' | 'is_verbatim' | 'is_verbatimHelp' | 'is_verbatimPreset' | 'is_verbatimPresetHelp' | 'is_knownBy' | 'is_knownBy_everyone' | 'is_knownBy_master' | 'is_sampling' | 'is_samplingHelp' | 'is_samplingNone' | 'is_import' | 'is_importing' | 'is_cancel' | 'is_close' | 'is_failed'
  | 'is_sampling_master' | 'is_sampling_characters' | 'is_sampling_topP' | 'is_sampling_topK' | 'is_sampling_minP' | 'is_sampling_frequencyPenalty' | 'is_sampling_presencePenalty' | 'is_sampling_repetitionPenalty'

export const dictionaries: Dictionaries<ImportSelectionKey> = {
  en: {
    is_title_preset: 'Choose what to import from {name}', is_title_lorebook: 'Choose what to import from {name}',
    is_help_preset: 'Only the prompts you tick are shown to the conversion, in the order the preset sends them. The ones you leave out are treated as if the preset never had them, and so is anything they set (variables included). The tool that wrote the preset had the ticked ones switched on.',
    is_help_lorebook: 'Only the entries you tick are shown to the conversion. The ones you leave out are treated as if the lorebook never had them. The ticked ones are the entries the file has switched on.',
    is_selected: '{on} of {total} selected', is_all: 'Select all', is_none: 'Select none', is_asFile: 'As in the file', is_chars: '{count} characters', is_show: 'Show the text',
    is_note_prefill: 'Written as the model\'s own reply, for one model: it cannot be carried over.', is_note_variables: 'Sets values that other prompts read: tick it too when you tick one that uses them.',
    is_note_always: 'Always on in SillyTavern. Here it is found when it bears on the scene, like any entry.',
    is_ignored: 'Not carried over, whatever you choose: {parts}.', is_ignored_regexScripts: '{count} regular expressions that rewrite replies', is_ignored_scripts: '{count} helper scripts',
    is_verbatimPreset: 'Without the assistant: keep the prompts word for word', is_verbatimPresetHelp: 'No model runs: the ticked prompts, in the order the file sends them, become the narration style of a new preset at once. Nothing is split between narration and characters, and the file\'s own rules are not sorted out; edit the result in the preset\'s editor.',
    is_verbatim: 'Without the assistant: keep the entries word for word', is_verbatimHelp: 'Nothing is sorted or rewritten and no model runs: each ticked entry becomes an entry of a new lorebook at once, with its keywords in the summary. Instructions to the AI in the file stay entries; change who knows an entry, or its kind, in the lorebook\'s editor.', is_knownBy: 'Who knows these entries', is_knownBy_everyone: 'Everyone in the story', is_knownBy_master: 'Only the game master (safe: nothing has read what they say)',
    is_sampling: 'Keep the sampling this file asks for', is_samplingHelp: 'It becomes the suggested sampling of the preset or the world, and a story started from it asks its models that way (only that story; the choices made at its start win).', is_samplingNone: 'The file asks for nothing beyond the server\'s defaults.',
    is_sampling_master: 'Narrator temperature', is_sampling_characters: 'Characters temperature', is_sampling_topP: 'Top P', is_sampling_topK: 'Top K', is_sampling_minP: 'Min P', is_sampling_frequencyPenalty: 'Frequency penalty', is_sampling_presencePenalty: 'Presence penalty', is_sampling_repetitionPenalty: 'Repetition penalty',
    is_import: 'Import', is_importing: 'Importing…', is_cancel: 'Cancel', is_close: 'Close', is_failed: 'Could not import: {message}',
  },
  zh: {
    is_title_preset: '选择要从 {name} 导入的内容', is_title_lorebook: '选择要从 {name} 导入的内容',
    is_help_preset: '只有勾选的提示词会交给转换，并按预设发送的顺序排列。没有勾选的会被当作预设里根本没有，它们设置的内容（包括变量）也一样。写出这份预设的工具原本开启的，会被预先勾选。',
    is_help_lorebook: '只有勾选的条目会交给转换。没有勾选的会被当作世界书里根本没有。预先勾选的是文件中已开启的条目。',
    is_selected: '已选 {on} / {total}', is_all: '全选', is_none: '全不选', is_asFile: '与文件一致', is_chars: '{count} 个字符', is_show: '显示文本',
    is_note_prefill: '以模型自己的回复写成，只为某一个模型准备：无法带入。', is_note_variables: '设置了其他提示词会读取的值：勾选用到它们的提示词时，也请勾选它。',
    is_note_always: '在 SillyTavern 中始终开启。在这里它和其他条目一样，与场景相关时才会被找到。',
    is_ignored: '无论如何选择都不会带入：{parts}。', is_ignored_regexScripts: '{count} 条改写回复的正则表达式', is_ignored_scripts: '{count} 个辅助脚本',
    is_verbatimPreset: '不使用助手：提示原文保留', is_verbatimPresetHelp: '不运行任何模型：勾选的提示按文件发送的顺序，立即成为新预设的叙述风格。不会区分叙述与角色，也不会梳理文件自带的规则；可在预设的编辑器里修改结果。',
    is_verbatim: '不使用助手：条目原文保留', is_verbatimHelp: '不分类、不改写，也不运行任何模型：每个勾选的条目立即成为新世界书中的一个条目，关键词写进摘要。文件里给 AI 的指令也会保留为条目；谁知道某个条目、它的类型，可以在世界书的编辑器里修改。', is_knownBy: '谁知道这些条目', is_knownBy_everyone: '故事里的所有人', is_knownBy_master: '只有游戏主持人（安全：还没有人读过它们的内容）',
    is_sampling: '保留这份文件要求的采样设置', is_samplingHelp: '它会成为预设或世界建议的采样设置，由此开始的故事会这样向模型提出请求（只对那个故事生效；开始时的选择优先）。', is_samplingNone: '这份文件没有提出超出服务器默认值的要求。',
    is_sampling_master: '叙述者温度', is_sampling_characters: '角色温度', is_sampling_topP: 'Top P', is_sampling_topK: 'Top K', is_sampling_minP: 'Min P', is_sampling_frequencyPenalty: '频率惩罚', is_sampling_presencePenalty: '存在惩罚', is_sampling_repetitionPenalty: '重复惩罚',
    is_import: '导入', is_importing: '正在导入…', is_cancel: '取消', is_close: '关闭', is_failed: '无法导入：{message}',
  },
}
