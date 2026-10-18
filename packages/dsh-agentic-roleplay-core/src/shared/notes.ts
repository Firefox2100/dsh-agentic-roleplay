/** What is shown to the player for a while beside the story, outside the conversation log. */
export type NoteKind = 'suggestions' | 'away' | 'world' | 'unwritten'

/** The kinds the host stores; `unwritten` is made when the notes are read, from the rounds still waiting for the record keeper. */
export const NOTE_KINDS: readonly NoteKind[] = ['suggestions', 'away', 'world']

/** One note: lines of text of one kind, made after a turn and gone when the next one starts. */
export interface Note {
  kind: NoteKind
  turn: number
  lines: string[]
  /** For `unwritten`: how many rounds wait to be written. */
  count?: number
}
