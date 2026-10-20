import type { LoreKind, LoreScope } from 'dsh-roleplay-model'

export interface LorebookSummary {
  name: string
  title: string
  description: string
  /** How many entries it holds. */
  entries: number
  /** How many of them everyone in a story knows; the rest are known to the characters they name, and to the game master. */
  common: number
  problems: string[]
}

/** One entry of a lorebook as the page edits it. */
export interface LorebookEntry {
  id: string
  title: string
  kind: LoreKind
  scope: LoreScope
  /** For a listed entry: the characters that know it, by name. */
  knownBy: string[]
  summary: string
  body: string
  /** The ids of other entries of the book. */
  related: string[]
}

export interface LorebookText {
  summary: LorebookSummary
  entries: LorebookEntry[]
}

export interface LorebookStatus {
  /** The lorebooks the story was started with. */
  applied: { name: string; entries: number }[]
  available: LorebookSummary[]
}
