/** One piece of a world's source card as the assistant names it. */
export interface CardPieceView {
  /** The id the assistant and the import use (`field:description`, `entry:3`). */
  id: string
  label: string
  title: string
  keys: string[]
  /** Characters of text, and the first of them. */
  length: number
  start: string
  /** Whether the import read it for the world. */
  used: boolean
  /** The entry's own switch in the card; absent for a field. */
  enabled?: boolean
  /** What the import took the piece to describe, when it got that far. */
  roles: string[]
}

/** The card kept in a world's import folder; `present` is false for a world that was not made from one. */
export interface CardView {
  present: boolean
  name?: string
  creator?: string
  hasPicture?: boolean
  pieces: CardPieceView[]
}

export interface CardPieceText { id: string; label: string; text: string }
