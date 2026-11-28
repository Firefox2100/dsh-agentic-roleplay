/** One claim as the editor shows it: all of it, including what the events say of it and whether anyone has settled it. */
export interface EditorClaim {
  id: number
  text: string
  by: string | null
  assertedIn: { id: number; text: string } | null
  status: 'proposed' | 'confirmed'
  /** What the events say of it so far; for a proposed claim this is the keeper's view, not a settled one. */
  verdict: string
  parts: { key: string; text: string }[]
  links: { event: number; text: string; as: string; part: string }[]
  turn: number
}

export interface EditorClaims {
  claims: EditorClaim[]
  questions: { id: number; text: string; rivals: number[] }[]
}
