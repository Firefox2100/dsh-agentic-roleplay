import type { WorldSummary } from './worlds.ts'

/** A catalogue as the person configured it. The key itself lives in DSH's credential store under `apiKeyRef`; the browser is only told whether there is one. */
export interface CatalogueSource {
  name: string
  baseUrl: string
  /** The credential the key is stored under; empty means the name derived from the catalogue's name (`catalogueKeyRef`). */
  apiKeyRef: string
  /** A key written in the profile's configuration by an earlier version. Still sent when the store has none for `apiKeyRef`, and removed when the settings are saved. */
  apiKey: string
}

/** What a credential reference is: letters, digits and `_`, not starting with a digit (DSH's grammar). */
export const CREDENTIAL_REF = /^[A-Za-z_][A-Za-z0-9_]*$/

function trimUnderscores(value: string): string {
  let start = 0
  let end = value.length
  while (value[start] === '_') start += 1
  while (value[end - 1] === '_') end -= 1
  return value.slice(start, end)
}

/** The credential a catalogue's key is stored under when its entry names none. Names with other characters get a short checksum so that two of them never share a key. */
export function catalogueKeyRef(name: string): string {
  const trimmed = name.trim()
  const slug = trimUnderscores(trimmed.normalize('NFKD').replace(/[^A-Za-z0-9]+/g, '_')).toUpperCase()
  let checksum = 0x811c9dc5
  for (const unit of trimmed) checksum = Math.imul(checksum ^ unit.codePointAt(0)!, 0x01000193) >>> 0
  const plain = slug !== '' && /^[A-Za-z0-9 _.-]+$/.test(trimmed)
  return `ROLEPLAY_CATALOGUE_${plain ? slug : `${slug === '' ? 'X' : slug}_${checksum.toString(16).toUpperCase()}`}_API_KEY`
}

/** The browser event settings fires after a key is stored or removed, so that the catalogue page reads its sources again. */
export const CATALOGUE_KEYS_CHANGED = 'roleplay:catalogue-keys-changed'

/** What the credential store says about one reference, never its value. */
export interface CatalogueKeyStatus {
  ref: string
  configured: boolean
  /** Whether a value can be stored for it from here: not while the launch environment supplies it. */
  writable: boolean
  /** Where the value comes from, as the store names it. */
  source?: string
}

export interface CatalogueSourceStatus {
  name: string
  baseUrl: string
  hasKey: boolean
  /** The credential the key is looked up under. */
  keyRef: string
  /** Where the key comes from, when there is one. */
  keySource?: string
  /** Whether the entry still holds a key in the profile's configuration. */
  legacyKey?: boolean
  /** Why the entry cannot be used, when it cannot. */
  problem?: string
}

export type CatalogueVisibility = 'public' | 'authenticated' | 'private'

/** What a catalogue entry is: a roleplay world (installed as it is), a SillyTavern character card (converted into a new world) a SillyTavern preset (converted into a library preset) or a SillyTavern lorebook (converted into a library lorebook, and a preset when it carries instructions). */
export type CatalogueKind = 'world' | 'card' | 'preset' | 'lorebook'

export const CATALOGUE_CARD_TYPE = 'sillytavern/character'
export const CATALOGUE_PRESET_TYPE = 'sillytavern/preset'
export const CATALOGUE_LOREBOOK_TYPE = 'sillytavern/lorebook'

export interface CatalogueWorld {
  id: string
  kind: CatalogueKind
  name: string
  description: string
  tags: string[]
  author: string
  visibility: CatalogueVisibility
  language: string
  views: number
  downloads: number
  hasCover: boolean
}

export interface CatalogueWorldPage {
  items: CatalogueWorld[]
  nextOffset?: number
  /** Whether the request carried the source's API key, which is what lets private worlds show. */
  withKey: boolean
}

export interface CatalogueVersion {
  id: string
  version: string
  publishedAt: string
  visibility: CatalogueVisibility
  byteSize?: number
  sha256?: string
}

export interface CatalogueWorldDetail extends CatalogueWorld {
  /** Newest first. */
  versions: CatalogueVersion[]
  /** The person's own world with the same identity, when they have one (worlds only). */
  installed?: InstalledWorld
  /** Worlds the person converted from this card earlier (cards only). A conversion is never an update of one of them. */
  converted?: { worldId: string; name: string; version: string }[]
}

export interface InstalledWorld {
  worldId: string
  name: string
  version?: string
  /** The release it was installed from, when this plugin recorded one. */
  versionId?: string
  /** Whether files differ from the release; `unknown` when no record of the release exists. */
  modified: boolean | 'unknown'
}

/** An installed world with a newer release in its catalogue. */
export interface CatalogueUpdate {
  worldId: string
  worldName: string
  resourceId: string
  installedVersion: string
  latest: CatalogueVersion
  modified: boolean
}

export interface CatalogueUpdates {
  updates: CatalogueUpdate[]
  /** Worlds that could not be checked, with why. */
  problems: { worldName: string; message: string }[]
}

export interface CatalogueQuery {
  kind?: CatalogueKind
  search?: string
  offset?: number
  sort?: 'recent' | 'popular'
}

/**
 * `new` refuses a world the person already has; `update` replaces that world with the release (refused while its files differ from the
 * release they came from, unless `overwriteChanges`); `copy` installs the release as a second, separate world.
 */
export type InstallMode = 'new' | 'update' | 'copy'

export interface InstallRequest {
  url: string
  /** What the download must hash to, when the catalogue stated it. */
  sha256?: string
  mode?: InstallMode
  overwriteChanges?: boolean
}

export interface InstallResult {
  world: WorldSummary
  /** Interface packs the world brought; they run their own scripts in the story's sandboxed frame. */
  packs: string[]
  /** Whether the world is tied to its catalogue release, which is what lets later releases be offered as updates. */
  tracked: boolean
  /** Where the world's previous files were kept, relative to the roleplay root, after an update. */
  backup?: string
}

/** The answer to a request to convert a catalogue card: the new world and the authoring chat that is converting it. */
export interface ConvertResult {
  worldId: string
  chatSessionId: string
  started: boolean
  failure?: string
}

export interface ConvertRequest {
  source: string
  versionId: string
  language?: string
}

/** The answer to a request to convert a catalogue preset: the new library preset and the authoring chat that is converting it. */
export interface ConvertPresetResult {
  name: string
  chatSessionId: string
  started: boolean
  failure?: string
}

export interface ConvertPresetRequest extends ConvertRequest {
  /** What the entry is called, from which the preset's name is made. */
  title?: string
}

/** Why a request was refused though the request itself was fine: what the person can decide. */
export type ConflictReason = 'exists' | 'modified' | 'unverified'

export const CATALOGUE_WORLD_TYPE = 'dsh-agentic-roleplay/world'
