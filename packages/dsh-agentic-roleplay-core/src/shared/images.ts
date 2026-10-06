export type SceneImageState = 'absent' | 'generating' | 'ready' | 'failed'

export interface SceneImageStatus {
  node: string
  mode: 'off' | 'manual' | 'every-turn'
  state: SceneImageState
  images: { serial: number; url: string }[]
  message?: string
}
