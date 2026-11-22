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
  /** The web addresses of the character card this picture was downloaded from, each with the ids of the card pieces (`field:description`, `entry:3`) the address was found in; none for a picture that did not come from a card. */
  cardLinks?: { url: string; pieces: string[] }[]
  /** An uploaded image that has not been described yet. */
  pending?: boolean
  /** The file carries no readable metadata. */
  unreadable?: boolean
}

/** The folder of images the person brought, inside a session's `images/`. */
export const LIBRARY_FOLDER = 'library'

export type GalleryFilter = 'all' | 'transient' | 'reference' | 'uploaded'

/** One page of a gallery, newest first, with the counts the whole gallery has. */
export interface GalleryPage {
  images: GalleryImage[]
  /** How many images match the filter, all pages together. */
  total: number
  /** How many images each filter matches, so the choice can say what it holds before it is made. */
  counts: Record<GalleryFilter, number>
  /** Pictures waiting to be described that did not fail, in the whole gallery, not only on this page. */
  waiting: number
  /** Why a picture that was added could not be described, by its path. */
  failures: Record<string, string>
}
