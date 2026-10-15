import type { Dictionaries } from '../i18n.ts'

export type InterfaceLocaleKey = 'tab' | 'notRoleplay' | 'noPack' | 'noTab' | 'problems' | 'hud' | 'dock' | 'opening' | 'backdrop' | 'sidebar' | 'sidebarTitle' | 'sidebarDescription' | 'sidebarBack' | 'sidebarNone'

export const dictionaries: Dictionaries<InterfaceLocaleKey> = {
  en: {
    tab: 'Interface',
    notRoleplay: 'This chat is not a roleplay session.',
    noPack: 'This story has no interface pack. A world can carry one in its ui folder, or you can put one in the ui folder of your roleplay folder and name it in the story\'s settings.',
    noTab: 'The interface pack of this story has no tab.',
    problems: 'The interface pack cannot be used:',
    hud: 'Status',
    dock: 'Actions',
    opening: 'Opening',
    backdrop: 'Backdrop',
    sidebar: 'Sidebar page',
    sidebarTitle: 'Interface page',
    sidebarDescription: 'A page of this story\'s interface pack',
    sidebarBack: 'Back',
    sidebarNone: 'This story\'s interface pack has no page for the sidebar.',
  },
  zh: {
    tab: '界面',
    notRoleplay: '此聊天不是角色扮演会话。',
    noPack: '此故事没有界面包。世界可以在其 ui 文件夹中携带界面包，也可以把界面包放进角色扮演目录的 ui 文件夹，并在故事设置中指定名称。',
    noTab: '此故事的界面包没有标签页。',
    problems: '无法使用界面包：',
    hud: '状态',
    dock: '操作',
    opening: '开场',
    backdrop: '背景',
    sidebar: '侧栏页面',
    sidebarTitle: '界面页面',
    sidebarDescription: '此故事界面包的一个页面',
    sidebarBack: '返回',
    sidebarNone: '此故事的界面包没有侧栏页面。',
  },
}
