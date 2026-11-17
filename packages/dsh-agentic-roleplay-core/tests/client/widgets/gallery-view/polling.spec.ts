import { describe, expect, it } from 'vitest'
import type { GalleryContents, GalleryImage } from '../../../../src/client/widgets/gallery-view/gallery-api.ts'
import { awaitsDescriptions, sameGallery } from '../../../../src/client/widgets/gallery-view/polling.ts'

const image = (path: string, pending: boolean): GalleryImage => ({ path, pending, subjects: [], tags: [] }) as unknown as GalleryImage
const contents = (images: GalleryImage[], failures: Record<string, string> = {}): GalleryContents => ({ images, failures }) as GalleryContents

describe('when a gallery reads its list again by itself', () => {
  it('does while a session\'s picture is being described, and not for a world\'s, a described one, one that failed, or a gallery not read yet', () => {
    const waiting = contents([image('a.png', true)])
    expect(awaitsDescriptions('sessions', waiting)).toBe(true)
    expect(awaitsDescriptions('worlds', waiting)).toBe(false)
    expect(awaitsDescriptions('sessions', contents([image('a.png', false)]))).toBe(false)
    expect(awaitsDescriptions('sessions', contents([image('a.png', true)], { 'a.png': 'the model cannot read images' }))).toBe(false)
    expect(awaitsDescriptions('sessions', contents([image('a.png', true), image('b.png', true)], { 'a.png': 'x' }))).toBe(true)
    expect(awaitsDescriptions('sessions', undefined)).toBe(false)
  })

  it('keeps what it shows when a read finds nothing new, so the page is not drawn again', () => {
    expect(sameGallery(contents([image('a.png', true)]), contents([image('a.png', true)]))).toBe(true)
    expect(sameGallery(contents([image('a.png', true)]), contents([image('a.png', false)]))).toBe(false)
    expect(sameGallery(contents([image('a.png', true)]), contents([image('a.png', true)], { 'a.png': 'x' }))).toBe(false)
  })
})
