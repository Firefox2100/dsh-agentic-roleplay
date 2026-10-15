/** The version of the bridge a surface talks to; a pack names the one it was written for. */
export const PACK_API = 1

/** What a surface may do for the player; a pack lists the ones it uses. */
export const PACK_ACTIONS = ['say', 'fill', 'choose', 'open'] as const
export type PackAction = (typeof PACK_ACTIONS)[number]

/** The places in the interface that take a surface. */
export const SURFACE_NAMES = ['hud', 'dock', 'opening', 'backdrop', 'tab', 'sidebar'] as const
export type SurfaceName = (typeof SURFACE_NAMES)[number]

/** The surfaces that sit in a strip of the chat and so have a height of their own, with the heights they may ask for. */
export const STRIP_HEIGHTS = {
  hud: { min: 24, max: 320, fallback: 56 },
  dock: { min: 24, max: 320, fallback: 48 },
  opening: { min: 120, max: 640, fallback: 320 },
} as const
export type StripSurface = keyof typeof STRIP_HEIGHTS
export const isStrip = (name: SurfaceName): name is StripSurface => name in STRIP_HEIGHTS

export const PACK_LIMITS = {
  files: 200,
  bytes: 5 * 1024 * 1024,
  fileBytes: 1024 * 1024,
  depth: 4,
  storageBytes: 64 * 1024,
  history: { fallback: 20, max: 100 },
} as const

/** Folder of a world, a session or the root that holds packs. */
export const PACKS_FOLDER = 'ui'

/** The file types a pack may carry, by extension. */
export const PACK_MEDIA_TYPES: Readonly<Record<string, string>> = {
  html: 'text/html; charset=utf-8',
  css: 'text/css; charset=utf-8',
  js: 'text/javascript; charset=utf-8',
  json: 'application/json; charset=utf-8',
  txt: 'text/plain; charset=utf-8',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
  avif: 'image/avif',
  svg: 'image/svg+xml',
  woff: 'font/woff',
  woff2: 'font/woff2',
  ttf: 'font/ttf',
  otf: 'font/otf',
  mp3: 'audio/mpeg',
  ogg: 'audio/ogg',
  wav: 'audio/wav',
}

/** The value of one theme token in both palettes, as DSH wants it. */
export interface PackToken { light: string; dark: string }

export interface PackSurface {
  /** The HTML file of the surface, relative to the pack. */
  file: string
  /** The name of a `tab` or `sidebar` page, for the guide card and assistive technology; the pack's name when empty. */
  title: string
  /** First guess of the height in pixels, for the surfaces that sit in a strip (`hud`, `dock`, `opening`). */
  height?: number
}

export interface PackManifest {
  id: string
  name: string
  version: string
  description: string
  api: number
  theme: Record<string, PackToken>
  skin?: string
  actions: PackAction[]
  surfaces: Partial<Record<SurfaceName, PackSurface>>
}

/** What the client needs of the active pack. */
export interface InterfaceDescription {
  id: string
  name: string
  version: string
  description: string
  /** Changes whenever a file of the pack does. */
  revision: string
  /** The key in the address of the files a surface loads itself: a frame has no login, so the address is the permission. */
  frame: string
  theme: Record<string, PackToken>
  /** The skin as it is put in the page: checked, with its urls pointing at the pack's file route. */
  skin: string
  actions: PackAction[]
  surfaces: Partial<Record<SurfaceName, PackSurface>>
}

export interface PackProblem {
  /** The file of the pack the problem is in; empty for the pack as a whole. */
  file: string
  message: string
}

export interface InterfacePayload {
  /** The pack in use; none when there is none, packs are off, or it has problems. */
  pack: InterfaceDescription | null
  problems: PackProblem[]
}

/** What the player may know of the story, for a surface to show. */
export interface PlayerView {
  api: number
  /** A hash of the view; the same view has the same revision. */
  revision: string
  story: { name: string; turn: number }
  player?: { key: string; name: string; summary: string; publicState: string }
  place?: {
    key: string
    name: string
    description: string
    features: { key: string; name: string }[]
    exits: { name: string; open: boolean }[]
    items: { name: string; quantity: number }[]
    here: { key: string; name: string; publicState: string }[]
  }
  /** Absent until the story's clock has started. */
  time?: { iso: string; zone: string; text: string }
  carried: { name: string; quantity: number; where: string }[]
  variables: { subject: string; name: string; value: string }[]
  map: {
    places: { key: string; name: string; parent?: string; here: boolean }[]
    routes: { from: string; to: string }[]
  }
  suggestions: string[]
}

/** One turn the player has been through, as the story told it. */
export interface HistoryTurn {
  turn: number
  /** What the player said. */
  player: string
  segments: { type: 'narration' | 'utterance'; name?: string; text: string }[]
  /** For an out-of-character command or question: what the player was told of it. */
  note?: string
}

/** The answer to a poll for the view: the view, or that it has not changed. */
export type PlayerViewReply = { unchanged: true } | { unchanged?: false; view: PlayerView }

/** A pack a story can use. */
export interface PackChoice {
  id: string
  name: string
  /** Whether the story carries it or it stands in the person's own `ui` folder. */
  from: 'story' | 'root'
  surfaces: SurfaceName[]
  /** What is wrong with it; a pack with problems cannot be used. */
  problems: PackProblem[]
}

/** A pack of a world as the editor shows it: what it holds, asks for and gets wrong. */
export interface WorldPackDetail {
  id: string
  name: string
  version: string
  description: string
  actions: PackAction[]
  surfaces: Partial<Record<SurfaceName, PackSurface>>
  skin?: string
  /** How many theme tokens it sets. */
  tokens: number
  files: { path: string; size: number }[]
  /** What is wrong with it; a pack with problems cannot be used, and shows no preview. */
  problems: PackProblem[]
}

/** A pack shown as it would be in a story of its world: its surfaces, and the view they are given. */
export interface PackPreview {
  pack: InterfaceDescription
  /** What the story would show at its start: the player's character, place and people, the map, what the world tracks. */
  view: PlayerView
}

/** How a pack of the world compares with the story's copy of it. */
export type WorldPackState = 'same' | 'different' | 'new'

/** What the settings of a story show about its interface pack. */
export interface InterfaceStatus {
  /** The setting as written: empty, `none` or a pack name. */
  setting: string
  /** The pack in use; none when there is none, packs are off, or it cannot be used. */
  active?: string
  /** What is wrong with the pack that was asked for. */
  problems: PackProblem[]
  available: PackChoice[]
  /** The world's packs against the story's copies; absent when the world cannot be found any more. */
  world?: { name: string; packs: { id: string; name: string; state: WorldPackState; problems: PackProblem[] }[] }
}

/** What bringing the world's packs into a story did. */
export interface InterfaceSync {
  updated: string[]
  added: string[]
  unchanged: string[]
}

/** Whether any pack with a tab exists, which decides whether the tab is offered. */
export interface InterfaceAvailability {
  tab: boolean
}
