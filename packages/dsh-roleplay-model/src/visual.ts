export const VISUAL_SUBJECT_KINDS = ['character', 'location', 'item'] as const
export type VisualSubjectKind = typeof VISUAL_SUBJECT_KINDS[number]

/** Stable, provider-neutral visual facts that every image of an entity should preserve. */
export interface VisualIdentityInput {
  description: string
  tags: string[]
  negativeTags: string[]
  /** A globally unique identity when the entity has one; world-local ids remain valid without it. */
  globalId?: string
}

/** A visual identity attached to one entity of a session. */
export interface VisualIdentity extends VisualIdentityInput {
  subjectKind: VisualSubjectKind
  subjectId: number
  /** Increases when the canonical identity changes, so an image can name what it was made from. */
  version: number
  updatedAt: string
}

export type VisualIdentityPatch = Partial<VisualIdentityInput>
