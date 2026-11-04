/** Whether the file in the root differs from the prompt the package ships. A different file may be the person's edit or a shipped text that has moved on since it was copied: nothing here can tell which. */
export type PromptState = 'default' | 'different'

export interface PromptEntry {
  /** The prompt's id, such as `roleplay/game-master`. */
  id: string
  language: string
  state: PromptState
}

export interface PromptDetail extends PromptEntry {
  /** The text in the root. */
  current: string
  /** The text the package ships now. */
  shipped: string
  /** The `${name}` variables the prompt is given; a text may use only these. */
  variables: string[]
}
