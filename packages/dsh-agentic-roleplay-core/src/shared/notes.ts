/** What is shown to the player for a while beside the story, outside the conversation log. */
export type NoteKind = 'suggestions' | 'away'

export const NOTE_KINDS: readonly NoteKind[] = ['suggestions', 'away']

/** One note: lines of text of one kind, made after a turn and gone when the next one starts. */
export interface Note {
  kind: NoteKind
  turn: number
  lines: string[]
}
