/** One image of a session, as the gallery lists it: where it is and what its file says about it. */
export interface GalleryImage {
  /** Relative to the session's `images/` folder, with `/`. */
  path: string
  /** A reference is an entity's canonical look; a transient image shows one moment; an uploaded one was put there by the person. */
  purpose: 'reference' | 'transient' | 'uploaded'
  /** Whether the image was made by the story's image generation or brought by the person. */
  origin: 'generated' | 'uploaded'
  /** Whether an image may be shown again in a later scene. Uploaded images always may; generated ones say so when made. */
  reusable: boolean
  /** When the file was written, from the metadata or else the file. */
  createdAt: string
  prompt?: string
  revisedPrompt?: string
  description?: string
  tags: string[]
  provider?: string
  model?: string
  subjects: { kind: string; name: string }[]
  source?: { turn: number; timelineNode: string; segment?: number }
  /** The name the file had when it was uploaded. */
  originalName?: string
  /** An uploaded image that has not been described yet. */
  pending?: boolean
  /** The file carries no readable metadata. */
  unreadable?: boolean
}

/** The folder of images the person brought, inside a session's `images/`. */
export const LIBRARY_FOLDER = 'library'
