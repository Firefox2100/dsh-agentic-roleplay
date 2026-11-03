/** One thing that differs between two states of a story. */
export interface StateChange {
  area: 'time' | 'turns' | 'position' | 'activity' | 'item' | 'variable' | 'thread' | 'relationship' | 'engagement'
  /** Who or what it is about. */
  subject: string
  /** How it is in the first state; absent when it did not exist there. */
  a?: string
  /** How it is in the second state. */
  b?: string
}

/** What differs between two states of a story: where they are, and the differences by area. */
export interface StoryComparison {
  a: string
  b: string
  changes: StateChange[]
}
