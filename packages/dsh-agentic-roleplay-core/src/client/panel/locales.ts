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
  ja: { label: 'ロールプレイ', heading: 'DSH エージェント・ロールプレイ', navLabel: 'ロールプレイのセクション' },
  es: { label: 'Juego de rol', heading: 'Juego de rol agéntico de DSH', navLabel: 'Secciones de juego de rol' },
  fr: { label: 'Jeu de rôle', heading: 'Jeu de rôle agentique DSH', navLabel: 'Sections du jeu de rôle' },
  de: { label: 'Rollenspiel', heading: 'Agentisches DSH-Rollenspiel', navLabel: 'Rollenspielbereiche' },
  ru: { label: 'Ролевая игра', heading: 'Агентная ролевая игра DSH', navLabel: 'Разделы ролевой игры' },
  pt: { label: 'Jogo de interpretação', heading: 'Jogo de interpretação agêntico do DSH', navLabel: 'Secções do jogo de interpretação' },
}
