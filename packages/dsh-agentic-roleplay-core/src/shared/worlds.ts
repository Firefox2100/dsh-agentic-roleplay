/** Path prefix of the plugin's HTTP API. Relative, so a mounted deployment resolves it against the page. */
export const API_PREFIX = 'roleplay-api'

export interface WorldAuthor {
  name: string
  url?: string
}

export interface WorldSummary {
  /** Stable identity of the world, kept in its `world.json`. */
  id: string
  name: string
  description: string
  tags: readonly string[]
  author?: WorldAuthor
  /** The author's own version label of the world. */
  version?: string
  /** Changes whenever the cover file does; absent when the world has no usable cover. */
  coverVersion?: string
}

export interface WorldProblem {
  path: string
  message: string
}

export interface WorldsPayload {
  /** Absolute path of the directory worlds are read from. */
  directory: string
  worlds: readonly WorldSummary[]
  problems: readonly WorldProblem[]
  scannedAt: number
}

export function worldCoverPath(id: string, version: string): string {
  return `${API_PREFIX}/worlds/cover?${new URLSearchParams({ id, v: version })}`
}
