import { createHash } from 'node:crypto'
import { dirname } from 'node:path'
import { CATALOGUE_CARD_TYPE, CATALOGUE_LOREBOOK_TYPE, CATALOGUE_PRESET_TYPE, CATALOGUE_WORLD_TYPE, type CatalogueQuery, type CatalogueSourceStatus, type CatalogueUpdate, type CatalogueUpdates, type CatalogueVersion, type CatalogueVisibility, type CatalogueWorld, type CatalogueWorldDetail, type CatalogueWorldPage, type ConvertPresetRequest, type ConvertPresetResult, type ConvertRequest, type ConvertResult, type InstallRequest, type InstallResult } from '../../shared/catalogue.ts'
import type { WorldCatalog } from '../worlds/catalog.ts'
import { CatalogueError } from './errors.ts'
import { installWorld } from './install.ts'
import { pruneTrash } from './trash.ts'
import { isUnchanged, localChanges, readOrigin, writeOrigin, type Provenance, type WorldOrigin } from './origin.ts'
import type { ResolvedSource, Sources } from './sources.ts'
import { fetchAddress, type Transport } from './transport.ts'

export const PAGE_SIZE = 24
const MAX_JSON_BYTES = 8 * 1024 * 1024
const MAX_COVER_BYTES = 20 * 1024 * 1024
const ID = /^[A-Za-z0-9_-]{1,100}$/
const VISIBILITY: readonly string[] = ['public', 'authenticated', 'private']

type Json = Record<string, unknown>

export interface CatalogueDeps {
  sources: Sources
  worlds: WorldCatalog
  /** The most a world download may be, compressed and unpacked. */
  maxBytes: () => number
  /** The most a character card download may be. */
  maxCardBytes: () => number
  /** Makes a new world of a card and has the authoring chat convert it. */
  /** Days replaced files stay in the trash; 0 for good. */
  trashDays: () => number
  /** Where a problem that does not stop the request is reported. */
  problem: (message: string) => void
  importCard: (card: Buffer, name: string, language?: string) => Promise<ConvertResult>
  /** Makes a new library preset of a SillyTavern preset, named after `title`, and has its authoring chat convert it. */
  importPreset: (file: Buffer, title: string, language?: string) => Promise<ConvertPresetResult>
  /** Makes a new library lorebook of a SillyTavern lorebook, named after `title`, and has its authoring chat convert it. */
  importLorebook: (file: Buffer, title: string, language?: string) => Promise<ConvertPresetResult>
  transport?: Transport
}

const CHECKED_AT_ONCE = 4

const unexpected = (what: string): CatalogueError => new CatalogueError(`the catalogue answered with something unexpected: ${what}`, 'upstream')
const object = (value: unknown, what: string): Json => { if (typeof value !== 'object' || value === null || Array.isArray(value)) throw unexpected(what); return value as Json }
const text = (value: unknown): string => (typeof value === 'string' ? value : '')
const count = (value: unknown): number => (typeof value === 'number' && Number.isFinite(value) ? value : 0)

const kindOf = (type: string): CatalogueWorld['kind'] => (type === CATALOGUE_CARD_TYPE ? 'card' : type === CATALOGUE_PRESET_TYPE ? 'preset' : type === CATALOGUE_LOREBOOK_TYPE ? 'lorebook' : 'world')
const TYPES = { world: CATALOGUE_WORLD_TYPE, card: CATALOGUE_CARD_TYPE, preset: CATALOGUE_PRESET_TYPE, lorebook: CATALOGUE_LOREBOOK_TYPE } as const

function worldOf(value: unknown): CatalogueWorld {
  const item = object(value, 'a world entry')
  const metadata = object(item['metadata'], 'a world entry without metadata')
  const id = text(item['id'])
  if (!ID.test(id)) throw unexpected('a world entry without an id')
  const visibility = text(metadata['visibility'])
  return {
    id, kind: kindOf(text(item['resourceType'])), name: text(metadata['name']), description: text(metadata['description']),
    tags: Array.isArray(metadata['tags']) ? metadata['tags'].filter((tag): tag is string => typeof tag === 'string') : [],
    author: text(item['authorUsername']), visibility: (VISIBILITY.includes(visibility) ? visibility : 'private') as CatalogueVisibility,
    language: text(metadata['language']), views: count(item['viewCount']), downloads: count(item['downloadCount']),
    hasCover: typeof item['coverImageResourceId'] === 'string' && item['coverImageResourceId'] !== '',
  }
}

function versionOf(value: unknown): { version: CatalogueVersion; number: number } {
  const item = object(value, 'a version entry')
  const id = text(item['id'])
  if (!ID.test(id)) throw unexpected('a version entry without an id')
  const visibility = text(item['visibility'])
  return {
    number: count(item['versionNumber']),
    version: {
      id, version: text(item['version']), publishedAt: text(item['publishedAt']), visibility: (VISIBILITY.includes(visibility) ? visibility : 'private') as CatalogueVisibility,
      ...(typeof item['artifactByteSize'] === 'number' ? { byteSize: item['artifactByteSize'] } : {}),
      ...(typeof item['artifactSha256'] === 'string' ? { sha256: item['artifactSha256'] } : {}),
    },
  }
}

/** Browsing the worlds a catalogue holds and installing one; the catalogue's API key goes with every request that belongs to its site. */
export class Catalogue {
  constructor(private readonly deps: CatalogueDeps) {}

  sources(): CatalogueSourceStatus[] {
    return this.deps.sources.status()
  }

  async worlds(name: string, query: CatalogueQuery): Promise<CatalogueWorldPage> {
    const source = this.deps.sources.get(name)
    const offset = Math.max(0, Math.floor(query.offset ?? 0))
    const params: Record<string, string> = { resourceType: TYPES[query.kind ?? 'world'], publishedOnly: 'true', limit: String(PAGE_SIZE), offset: String(offset), sort: query.sort ?? 'recent' }
    const search = query.search?.trim() ?? ''
    if (search !== '') params['search_string'] = search.slice(0, 200)
    const answer = object(await this.json(source, '/resources', params), 'the list of worlds')
    if (!Array.isArray(answer['items'])) throw unexpected('the list of worlds has no items')
    const next = answer['nextOffset']
    return { items: answer['items'].map(worldOf), ...(typeof next === 'number' ? { nextOffset: next } : {}), withKey: source.apiKey !== undefined }
  }

  async world(name: string, id: string): Promise<CatalogueWorldDetail> {
    const source = this.deps.sources.get(name)
    const world = worldOf(await this.json(source, `/resources/${this.identifier(id)}`))
    const listed = await this.json(source, `/versions/resource/${this.identifier(id)}`)
    if (!Array.isArray(listed)) throw unexpected('the list of versions')
    const versions = listed.map(versionOf).sort((a, b) => b.number - a.number).map(entry => entry.version)
    if (world.kind === 'card') {
      const converted = (await this.origins()).filter(({ origin }) => origin?.kind === 'card' && origin.resourceId === id && this.deps.sources.match(new URL(origin.root))?.name === source.name)
      return { ...world, versions, converted: converted.map(({ name: worldName, worldId, origin }) => ({ worldId, name: worldName, version: origin?.version ?? '' })) }
    }
    const latest = versions[0]
    let installed: CatalogueWorldDetail['installed']
    if (latest !== undefined) {
      const data = object(object(await this.json(source, `/versions/${latest.id}/data`), 'the data of a version')['data'], 'the data of a version')
      const worldId = text(data['worldId'])
      const mine = worldId === '' ? undefined : (await this.deps.worlds.list()).worlds.find(existing => existing.id === worldId)
      if (mine !== undefined) {
        const record = await this.deps.worlds.find(mine.id)
        const origin = record === undefined ? undefined : await readOrigin(record.directory)
        const changes = record === undefined ? 'unverified' : await localChanges(record.directory)
        installed = {
          worldId: mine.id, name: mine.name, ...(mine.version === undefined ? {} : { version: mine.version }),
          ...(origin?.kind === 'release' ? { versionId: origin.versionId } : {}),
          modified: changes === 'unverified' ? 'unknown' : !isUnchanged(changes),
        }
      }
    }
    return { ...world, versions, ...(installed === undefined ? {} : { installed }) }
  }

  /** Installed worlds with a newer release in the catalogue, and the worlds that could not be checked. */
  async updates(name: string): Promise<CatalogueUpdates> {
    const source = this.deps.sources.get(name)
    const mine = (await this.origins()).filter(({ origin, problem }) => problem !== undefined || (origin?.kind === 'release' && this.deps.sources.match(new URL(origin.root))?.name === source.name))
    const result: CatalogueUpdates = { updates: [], problems: [] }
    for (let from = 0; from < mine.length; from += CHECKED_AT_ONCE) {
      await Promise.all(mine.slice(from, from + CHECKED_AT_ONCE).map(async ({ worldId, name: worldName, directory, origin, problem }) => {
        try {
          if (problem !== undefined) throw new CatalogueError(problem, 'invalid')
          if (origin?.kind !== 'release') return
          const listed = await this.json(source, `/versions/resource/${this.identifier(origin.resourceId)}`)
          if (!Array.isArray(listed)) throw unexpected('the list of versions')
          const entries = listed.map(versionOf).sort((a, b) => b.number - a.number)
          const latest = entries[0]
          const installed = entries.find(entry => entry.version.id === origin.versionId)
          if (latest === undefined || latest.version.id === origin.versionId || (installed !== undefined && latest.number <= installed.number)) return
          const changes = await localChanges(directory)
          const update: CatalogueUpdate = { worldId, worldName, resourceId: origin.resourceId, installedVersion: origin.version, latest: latest.version, modified: changes === 'unverified' ? true : !isUnchanged(changes) }
          result.updates.push(update)
        } catch (error) {
          result.problems.push({ worldName, message: error instanceof Error ? error.message : String(error) })
        }
      }))
    }
    result.updates.sort((a, b) => a.worldName.localeCompare(b.worldName))
    return result
  }

  async cover(name: string, id: string): Promise<{ type: string; body: Buffer }> {
    const source = this.deps.sources.get(name)
    const reply = await fetchAddress(this.address(source, `/images/covers/resources/${this.identifier(id)}`), { sources: this.deps.sources, maxBytes: MAX_COVER_BYTES, accept: 'image/*', ...(this.deps.transport === undefined ? {} : { transport: this.deps.transport }) })
    if (!reply.type.startsWith('image/')) throw unexpected('the cover is not a picture')
    return { type: reply.type, body: reply.body }
  }

  /**
   * Downloads a world archive from an address and installs it. The address may be any ZIP link: one on a configured catalogue's site is asked
   * for with that catalogue's key, any other plainly (and only when it is a public address).
   * @throws {CatalogueError} when the address cannot be fetched, is not a world archive, or names a world the person has.
   */
  async install(request: InstallRequest): Promise<InstallResult> {
    const address = request.url.trim()
    if (address === '') throw new CatalogueError('give the address of a world archive', 'input')
    let url: URL
    try { url = new URL(address) } catch { throw new CatalogueError(`"${address}" is not an address`, 'input') }
    const reply = await fetchAddress(url.href, { sources: this.deps.sources, maxBytes: this.deps.maxBytes(), accept: 'application/zip, application/octet-stream;q=0.9, */*;q=0.1', ...(this.deps.transport === undefined ? {} : { transport: this.deps.transport }) })
    if (reply.body.length < 4 || reply.body.readUInt32LE(0) !== 0x04034b50) throw new CatalogueError(`${url.href} did not answer with a ZIP archive${reply.type === '' ? '' : ` (it sent ${reply.type})`}`, 'invalid')
    if (request.sha256 !== undefined && createHash('sha256').update(reply.body).digest('hex') !== request.sha256.toLowerCase()) throw new CatalogueError('the download does not match the checksum the catalogue published for it', 'invalid')
    const provenance = await this.provenance(url)
    const installed = await installWorld(this.deps.worlds, reply.body, this.deps.maxBytes(), { mode: request.mode ?? 'new', overwriteChanges: request.overwriteChanges === true, ...(provenance === undefined ? {} : { provenance }) })
    if (installed.backup !== undefined) await this.tidy()
    return installed
  }

  /** Deletes what updates left in the trash past the configured time; a failure is reported and never fails the request that triggered it. */
  async tidy(): Promise<void> {
    try {
      const { failures } = await pruneTrash(dirname(this.deps.worlds.directory), this.deps.trashDays())
      for (const failure of failures) this.deps.problem(`could not remove old catalogue files: ${failure}`)
    } catch (error) {
      this.deps.problem(`could not clean the catalogue trash: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  /**
   * Turns a character card of a catalogue into a new world: the card is downloaded with the catalogue's key and handed to the importer, whose
   * authoring chat does the conversion. The conversion is made by an agent and differs from run to run, so it never replaces a world: converting
   * again makes another one.
   */
  async convert(request: ConvertRequest): Promise<ConvertResult> {
    const source = this.deps.sources.get(request.source)
    const release = await this.download(source, request.versionId, CATALOGUE_CARD_TYPE, 'a character card')
    const png = release.body.subarray(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47]))
    const converted = await this.deps.importCard(release.body, `${release.versionId}${png ? '.png' : '.json'}`, request.language)
    const record = await this.deps.worlds.find(converted.worldId)
    if (record === undefined) throw new CatalogueError('the world was made but cannot be found', 'upstream')
    await writeOrigin(record.directory, { kind: 'card', root: source.root, resourceId: release.resourceId, versionId: release.versionId, version: release.version })
    return converted
  }

  /** Turns a SillyTavern lorebook of a catalogue into a new library lorebook, which its authoring chat fills with entries. Like a card it is never an update of an earlier one. */
  async convertLorebook(request: ConvertPresetRequest): Promise<ConvertPresetResult> {
    const release = await this.download(this.deps.sources.get(request.source), request.versionId, CATALOGUE_LOREBOOK_TYPE, 'a lorebook')
    return await this.deps.importLorebook(release.body, request.title ?? '', request.language)
  }

  /** Turns a SillyTavern preset of a catalogue into a new library preset, which its authoring chat fills with prompts. Like a card it is never an update of an earlier one. */
  async convertPreset(request: ConvertPresetRequest): Promise<ConvertPresetResult> {
    const release = await this.download(this.deps.sources.get(request.source), request.versionId, CATALOGUE_PRESET_TYPE, 'a preset')
    return await this.deps.importPreset(release.body, request.title ?? '', request.language)
  }

  /** A release of the given type, downloaded with the catalogue's key and checked against the checksum it published. */
  private async download(source: ResolvedSource, versionIdText: string, type: string, what: string): Promise<{ body: Buffer; versionId: string; resourceId: string; version: string }> {
    const versionId = this.identifier(versionIdText)
    const version = object(await this.json(source, `/versions/${versionId}`), 'a version')
    if (text(version['resourceType']) !== type) throw new CatalogueError(`that release is not ${what}`, 'invalid')
    const resourceId = text(version['resourceId'])
    if (!ID.test(resourceId)) throw unexpected('a version without a resource id')
    const reply = await fetchAddress(this.address(source, `/versions/${versionId}/download`), { sources: this.deps.sources, maxBytes: this.deps.maxCardBytes(), accept: '*/*', ...(this.deps.transport === undefined ? {} : { transport: this.deps.transport }) })
    const sha256 = text(version['artifactSha256'])
    if (sha256 !== '' && createHash('sha256').update(reply.body).digest('hex') !== sha256.toLowerCase()) throw new CatalogueError('the download does not match the checksum the catalogue published for it', 'invalid')
    return { body: reply.body, versionId, resourceId, version: text(version['version']) }
  }

  /** The catalogue release an address names, when it is a release download on a configured catalogue. */
  private async provenance(url: URL): Promise<Provenance | undefined> {
    const source = this.deps.sources.match(url)
    if (source === undefined) return undefined
    const named = /^\/versions\/([A-Za-z0-9_-]{1,100})\/download$/.exec(url.pathname.slice(source.prefix.length))
    if (named === null) return undefined
    const version = object(await this.json(source, `/versions/${named[1]}`), 'a version')
    const resourceId = text(version['resourceId'])
    if (!ID.test(resourceId)) throw unexpected('a version without a resource id')
    return { root: source.root, resourceId, versionId: named[1]!, version: text(version['version']) }
  }

  /** Every world with the record of where it came from, or why that record cannot be read. */
  private async origins(): Promise<{ worldId: string; name: string; directory: string; origin?: WorldOrigin; problem?: string }[]> {
    const found: { worldId: string; name: string; directory: string; origin?: WorldOrigin; problem?: string }[] = []
    for (const summary of (await this.deps.worlds.list()).worlds) {
      const record = await this.deps.worlds.find(summary.id)
      if (record === undefined) continue
      try {
        const origin = await readOrigin(record.directory)
        found.push({ worldId: summary.id, name: summary.name, directory: record.directory, ...(origin === undefined ? {} : { origin }) })
      } catch (error) {
        found.push({ worldId: summary.id, name: summary.name, directory: record.directory, problem: error instanceof Error ? error.message : String(error) })
      }
    }
    return found
  }

  private identifier(id: string): string {
    if (!ID.test(id)) throw new CatalogueError('that is not a catalogue id', 'input')
    return id
  }

  private address(source: ResolvedSource, path: string, params: Record<string, string> = {}): string {
    const url = new URL(`${source.root}${path}`)
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value)
    return url.href
  }

  private async json(source: ResolvedSource, path: string, params: Record<string, string> = {}): Promise<unknown> {
    const reply = await fetchAddress(this.address(source, path, params), { sources: this.deps.sources, maxBytes: MAX_JSON_BYTES, accept: 'application/json', ...(this.deps.transport === undefined ? {} : { transport: this.deps.transport }) })
    try { return JSON.parse(reply.body.toString('utf8')) as unknown } catch { throw unexpected('it is not JSON: is the address the catalogue\'s API root?') }
  }
}
