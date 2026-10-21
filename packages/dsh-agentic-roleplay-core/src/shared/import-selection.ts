import type { StorySampling } from './sampling.ts'

/** One thing a file offers to an import: a prompt of a preset, an entry of a lorebook. */
export interface SelectionItem {
  /** Names the item in a choice: stable for the file. */
  id: string
  title: string
  /** What helps tell it apart: the keys of a lorebook entry, the role of a preset prompt. */
  detail: string
  /** The start of its text, as it is in the file. */
  text: string
  /** The length of the whole text. */
  chars: number
  /** Whether the file itself has it switched on. */
  enabled: boolean
  /** False when it cannot be carried over, whatever the person chooses. */
  usable: boolean
  /** A reason worth telling beside it. `prefill`: written for one model's reply, not carried. `variables`: sets values that other prompts read. `always`: always on in SillyTavern; here it is found when it bears on the scene, like any entry. */
  note?: 'prefill' | 'variables' | 'always'
}

export type SelectionKind = 'preset' | 'lorebook'

/** What an uploaded or downloaded file holds, before anything is made of it. */
export interface SelectionPreview {
  /** The staged file: the choice names it. */
  id: string
  kind: SelectionKind
  /** The name the file gives itself. */
  name: string
  items: SelectionItem[]
  /** What the file holds that is not carried over whatever is chosen: scripts of the tool that wrote it, counted. */
  ignored?: { regexScripts?: number; scripts?: number }
  /** What the file asks of the model's sampling, mapped to the controls of a story; absent when it asks nothing. */
  sampling?: StorySampling
}

/** What the person decided: only these items are shown to the conversion, the rest are treated as if the file did not have them. */
export interface SelectionChoice {
  id: string
  enabled: string[]
  /** Whether the file's sampling is kept. */
  sampling: boolean
}

export const MAX_PREVIEW_TEXT = 4000
