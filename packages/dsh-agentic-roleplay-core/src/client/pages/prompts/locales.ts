import type { Dictionaries } from '../../i18n.ts'

export type PromptsLocaleKey =
  | 'nav' | 'loading' | 'loadFailed' | 'refresh' | 'refreshing' | 'back' | 'cancel' | 'close' | 'empty'
  | 'countOne' | 'countOther' | 'help' | 'differentOnly' | 'allLanguages' | 'language' | 'different' | 'differentHint'
  | 'yours' | 'shippedText' | 'shippedHelp' | 'variables' | 'noVariables' | 'save' | 'saving' | 'saved' | 'saveFailed' | 'undo'
  | 'replace' | 'replaceTitle' | 'replaceHelp' | 'replacing' | 'replaceFailed' | 'sameAsShipped' | 'comparison' | 'rulesWarning' | 'unsaved'

export const dictionaries: Dictionaries<PromptsLocaleKey> = {
  en: {
    nav: 'Prompts', loading: 'Loading…', loadFailed: 'Could not load the prompts: {message}', refresh: 'Refresh', refreshing: 'Refreshing…', back: 'Back', cancel: 'Cancel', close: 'Close', empty: 'No prompts match.',
    countOne: '1 prompt', countOther: '{count} prompts',
    help: 'The instructions the models are given. The files are in your roleplay root and are never replaced by an update. A prompt marked with ≠ differs from the one this version ships: you may have edited it, or the shipped text may have changed since it was copied.',
    differentOnly: 'Only those that differ', allLanguages: 'All languages', language: 'Language', different: '≠', differentHint: 'Differs from the shipped text: edited by you, or the shipped text has changed since.',
    yours: 'Your file', shippedText: 'Shipped with this version', shippedHelp: 'Lines the shipped text has that yours does not are highlighted. Read it to bring a new rule into your own text, or replace your file with it.',
    variables: 'It is given {list}. Use only these.', noVariables: 'It is given no variables.', save: 'Save', saving: 'Saving…', saved: 'Saved. It applies from the next request.', saveFailed: 'Could not save: {message}', undo: 'Discard my changes',
    replace: 'Replace with the shipped text', replaceTitle: 'Replace your file?', replaceHelp: 'Your file {name} ({language}) is replaced by the text this version ships. Your current file is kept in the trash folder of your roleplay root.', replacing: 'Replacing…', replaceFailed: 'Could not replace it: {message}',
    sameAsShipped: 'Your file is the same as the shipped text.', comparison: '{missing} shipped line(s) are not in your text; {extra} line(s) of yours are not in the shipped one.',
    rulesWarning: 'This prompt carries rules of how the story is run. A change affects every story that uses the root prompts.', unsaved: 'Unsaved changes',
  },
  zh: {
    nav: '提示词', loading: '正在加载…', loadFailed: '无法加载提示词：{message}', refresh: '刷新', refreshing: '正在刷新…', back: '返回', cancel: '取消', close: '关闭', empty: '没有符合的提示词。',
    countOne: '1 条提示词', countOther: '{count} 条提示词',
    help: '交给模型的指令。文件在你的角色扮演根目录中，更新不会替换它们。标有 ≠ 的提示词与本版本自带的不同：可能是你改过，也可能是自带文本在复制之后有了变化。',
    differentOnly: '只看不同的', allLanguages: '所有语言', language: '语言', different: '≠', differentHint: '与自带文本不同：可能是你改过，也可能是自带文本之后有了变化。',
    yours: '你的文件', shippedText: '本版本自带', shippedHelp: '自带文本中有、而你的文本里没有的行会高亮显示。可以对照着把新规则加进你自己的文本，也可以直接用它替换你的文件。',
    variables: '它会收到 {list}，只能使用这些。', noVariables: '它不会收到任何变量。', save: '保存', saving: '正在保存…', saved: '已保存，从下一次请求起生效。', saveFailed: '无法保存：{message}', undo: '放弃我的修改',
    replace: '用自带文本替换', replaceTitle: '替换你的文件？', replaceHelp: '你的文件 {name}（{language}）会被本版本自带的文本替换。你当前的文件会保留在角色扮演根目录的回收文件夹中。', replacing: '正在替换…', replaceFailed: '无法替换：{message}',
    sameAsShipped: '你的文件与自带文本相同。', comparison: '自带文本中有 {missing} 行不在你的文本里；你的文本中有 {extra} 行不在自带文本里。',
    rulesWarning: '这条提示词包含故事如何运行的规则。修改会影响所有使用根目录提示词的故事。', unsaved: '有未保存的修改',
  },
}
