import type { GalleryPage } from './gallery-api.ts'

/** How often the list is read again while pictures are waiting to be described. */
export const POLL_MS = 3000

/** Whether a quiet read found nothing new, so the page keeps what it shows and nothing is drawn again. */
export const sameGallery = (a: GalleryPage, b: GalleryPage): boolean => JSON.stringify(a) === JSON.stringify(b)

/**
 * Whether a session's gallery has pictures being described in the background, which is what makes it read the list again by itself. A world's gallery never does: nothing describes its
 * pictures but the person pressing Describe, and the answer comes back to that press. A picture whose description failed is not waiting.
 */
export function awaitsDescriptions(kind: string, contents: GalleryPage | undefined): boolean {
  return kind !== 'worlds' && contents !== undefined && contents.waiting > 0
}
