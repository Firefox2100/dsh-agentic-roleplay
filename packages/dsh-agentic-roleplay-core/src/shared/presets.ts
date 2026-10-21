import type { StorySampling } from './sampling.ts'

/** How a preset suggests the story's models be asked; the helper agents' exact settings are never a preset's to change. */
export type PresetSampling = StorySampling

export interface PresetSummary {
  name: string
  title: string
  description: string
  /** The languages the preset has prompts in. */
  languages: string[]
  /** The prompts it carries, as `roleplay/style`. */
  prompts: string[]
  /** The prompts it carries that are rules of the game rather than prose: they change how the models are told to work, not only how the story reads. */
  rules: string[]
  sampling: PresetSampling
  problems: string[]
}

/** `current`: the story's copies are the library's; `changed`: the library has changed since; `edited`: a copy was edited in the story; `missing`: the library no longer has it. */
export type PresetState = 'current' | 'changed' | 'edited' | 'missing'

export interface PresetStatus {
  applied?: { name: string; state: PresetState; files: string[] }
  available: PresetSummary[]
}

export interface PresetChange {
  /** Files of the story's prompts that were replaced, and where the old copies went. */
  files: string[]
}

export interface SavePresetRequest {
  name: string
  title?: string
  description?: string
  sampling?: PresetSampling
  /** The world whose own prose prompts become the preset. */
  fromWorld: string
}
