import type { Dictionaries } from '../i18n.ts'

export type PanelLocaleKey = 'label' | 'heading' | 'navLabel'

export const dictionaries: Dictionaries<PanelLocaleKey> = {
  en: {
    label: 'Role Play',
    heading: 'DSH Agentic Role Play',
    navLabel: 'Role Play sections',
  },
  zh: {
    label: '角色扮演',
    heading: 'DSH 智能体角色扮演',
    navLabel: '角色扮演栏目',
  },
}
