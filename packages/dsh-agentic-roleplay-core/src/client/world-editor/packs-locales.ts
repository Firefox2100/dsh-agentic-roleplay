import type { Dictionaries } from '../i18n.ts'

export type PacksLocaleKey =
  | 'title' | 'help' | 'none' | 'loading' | 'loadFailed' | 'version' | 'actions' | 'noActions' | 'surfaces' | 'skin' | 'tokens' | 'files' | 'problems' | 'preview' | 'previewNote' | 'previewFailed' | 'previewBlocked'
  | 'hud' | 'dock' | 'opening' | 'backdrop' | 'tab' | 'sidebar' | 'surface' | 'width' | 'narrow' | 'medium' | 'wide' | 'reload' | 'log' | 'logEmpty' | 'logSay' | 'logFill' | 'logOpen' | 'noSurfaces'

export const dictionaries: Dictionaries<PacksLocaleKey> = {
  en: {
    title: 'Interface', help: 'The interface packs this world carries: files in its ui folder that restyle the story and add surfaces of their own. Ask the authoring assistant to make or change one. A story of the world gets a copy when it starts.', none: 'This world carries no interface pack.',
    loading: 'Reading the packs…', loadFailed: 'Could not read the packs: {message}', version: 'version {version}', actions: 'May act as the player', noActions: 'Cannot act as the player', surfaces: 'Surfaces', skin: 'Skin: {file}', tokens: '{count} theme token(s)', files: 'Files', problems: 'What is wrong with it',
    preview: 'Preview', previewNote: 'Shown with the story the world starts with: its first playable character, where they stand and who is with them. The skin and the theme are applied in a story, not here. Nothing said here is sent anywhere.', previewFailed: 'Could not show the preview: {message}', previewBlocked: 'A pack with problems cannot be previewed.',
    hud: 'Status strip', dock: 'Strip above the input', opening: 'Opening card', backdrop: 'Backdrop', tab: 'Tab', sidebar: 'Right sidebar page', surface: 'Surface', width: 'Width', narrow: 'Narrow', medium: 'Medium', wide: 'Wide', reload: 'Reload', log: 'What the pack did', logEmpty: 'Nothing yet. Press a button in the pack.', logSay: 'said as the player: {text}', logFill: 'put in the input: {text}', logOpen: 'asked to open: {surface}', noSurfaces: 'The pack has no surface to preview.',
  },
  zh: {
    title: '界面', help: '这个世界携带的界面包：放在它 ui 文件夹里的文件，可以改变故事的外观并添加自己的界面。可以让创作助手来创建或修改。由这个世界开始的故事在开始时会得到一份拷贝。', none: '这个世界没有携带界面包。',
    loading: '正在读取界面包…', loadFailed: '无法读取界面包：{message}', version: '版本 {version}', actions: '可以代玩家行动', noActions: '不能代玩家行动', surfaces: '界面位置', skin: '皮肤：{file}', tokens: '{count} 个主题颜色', files: '文件', problems: '存在的问题',
    preview: '预览', previewNote: '以这个世界开始时的故事来显示：第一个可扮演的角色、他所在的位置和身边的人。皮肤和主题在故事里生效，这里不应用。这里说的话不会发到任何地方。', previewFailed: '无法显示预览：{message}', previewBlocked: '有问题的界面包无法预览。',
    hud: '状态条', dock: '输入框上方的条', opening: '开场卡片', backdrop: '背景', tab: '标签页', sidebar: '右侧栏页面', surface: '界面位置', width: '宽度', narrow: '窄', medium: '中', wide: '宽', reload: '重新载入', log: '界面包的动作', logEmpty: '还没有。请点一下界面包里的按钮。', logSay: '以玩家身份说：{text}', logFill: '填入输入框：{text}', logOpen: '请求打开：{surface}', noSurfaces: '这个界面包没有可预览的界面位置。',
  },
}
