import type { GalleryImage } from './gallery.ts'

export type SceneImageState = 'absent' | 'generating' | 'ready' | 'failed'

export interface SceneImageStatus {
  node: string
  mode: 'off' | 'manual' | 'every-turn'
  state: SceneImageState
  /** `existing`: an image the session already had, shown for this turn instead of a new one. */
  images: { serial: number; url: string; details?: GalleryImage; existing?: true }[]
  message?: string
}
