import { randomBytes } from 'node:crypto'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { isSessionId, sessionDatabase, sessionFolder } from '@dsh-agentic-roleplay/state'
import { PACKS_FOLDER, PACK_LIMITS, type HistoryTurn, type InterfaceAvailability, type InterfacePayload, type InterfaceStatus, type InterfaceSync, type PackChoice, type PackPreview, type PlayerViewReply, type SurfaceName, type WorldPackDetail } from '../../shared/interface-pack.ts'
import { pathTo } from '../../shared/timeline.ts'
import { readTimeline } from '../timeline/file.ts'
import { zoneOf } from '../clock/story-clock.ts'
import { SessionNotFoundError, WorldNotFoundError } from '../sessions/errors.ts'
import { liveSettings } from '../sessions/settings.ts'
import { withBridge } from './frame.ts'
import type { WorldRecord } from '../worlds/scan.ts'
import { describePack, isPackId, packFile, readPack, type LoadedPack } from './pack.ts'
import { previewViewOf } from './preview.ts'
import { activePack, anyTab, packIds, syncWorldPacks, worldPackStates, type ActivePack } from './packs.ts'
import { playerViewOf, type ViewSession } from './player-view.ts'
import { PackStorage } from './storage.ts'

/** The packs of a world cannot be brought into a story because some of them have problems. */
export class InvalidPacksError extends Error {
  constructor(message: string, readonly problems: { path: string; message: string }[]) { super(message) }
}

export interface InterfaceDeps {
  open(id: string): ViewSession
  /** The folder of the world with that id, when the person still has it. */
  worldDirectory(worldId: string): Promise<string | undefined>
  /** The world with that id, when the person still has it. */
  world(worldId: string): Promise<Pick<WorldRecord, 'directory' | 'summary' | 'clock' | 'variables'> | undefined>
  /** The roleplay root. */
  root(): string
  wall?: () => number
}

/** A pack file as the browser gets it: the bytes of a file, or a page made of one. */
export type PackResponse = { kind: 'file'; file: string; size: number; mediaType: string } | { kind: 'page'; body: string; mediaType: string }

/** What stands for a pack looked at in the editor where a session id would be; the key after it is the frame's. */
const PREVIEW = 'preview:'

const addressFor = (session: string) => (path: string): string => `roleplay-api/sessions/interface/pack/${session}/${path.split('/').map(encodeURIComponent).join('/')}`

/** What the interface packs of the stories show and do, for the browser. */
export class InterfaceService {
  private readonly keys = new Map<string, string>()
  private readonly keyOf = new Map<string, string>()
  /** The pack folders being previewed, by frame key. */
  private readonly previews = new Map<string, { folder: string; pack: string }>()

  constructor(private readonly deps: InterfaceDeps) {}

  /** The key of a session's frames: the same for as long as the host runs, unguessable. */
  private frameKey(session: string): string {
    const known = this.keyOf.get(session)
    if (known !== undefined) return known
    const key = randomBytes(24).toString('base64url')
    this.keyOf.set(session, key)
    this.keys.set(key, session)
    return key
  }

  /** The session a frame key belongs to, if it is one the host made. */
  sessionOfFrame(key: string): string | undefined { return this.keys.get(key) }

  private sessions(): string { return join(this.deps.root(), 'sessions') }

  private async worldOf(worldId: string): Promise<Pick<WorldRecord, 'directory' | 'summary' | 'clock' | 'variables'>> {
    const world = await this.deps.world(worldId)
    if (world === undefined) throw new WorldNotFoundError(`there is no world "${worldId}"`)
    return world
  }

  /** The packs of a world, each with what it holds and what is wrong with it. @throws {WorldNotFoundError} */
  async worldPacks(worldId: string): Promise<WorldPackDetail[]> {
    const { directory } = await this.worldOf(worldId)
    return packIds(directory).map((id): WorldPackDetail => {
      const { pack, problems } = readPack(join(directory, PACKS_FOLDER, id), id, file => file)
      if (pack === undefined) return { id, name: id, version: '', description: '', actions: [], surfaces: {}, tokens: 0, files: [], problems }
      const { manifest } = pack
      return { id, name: manifest.name, version: manifest.version, description: manifest.description, actions: manifest.actions, surfaces: manifest.surfaces, ...(manifest.skin === undefined ? {} : { skin: manifest.skin }), tokens: Object.keys(manifest.theme).length, files: [...pack.files].map(([path, file]) => ({ path, size: file.size })), problems }
    })
  }

  /**
   * A pack of a world as a story of that world would start with it: its surfaces load their own files, and are given the view the story would show.
   * @throws {WorldNotFoundError} when the world, or the pack in it, is not there.
   * @throws {InvalidPacksError} when the pack has problems.
   * @throws {InvalidEditProblems} when the rest of the world has problems of its own.
   */
  async preview(worldId: string, packId: string): Promise<PackPreview> {
    const world = await this.worldOf(worldId)
    const folder = join(world.directory, PACKS_FOLDER, packId)
    if (!isPackId(packId) || !existsSync(folder)) throw new WorldNotFoundError(`the world carries no pack "${packId}"`)
    const name = `${worldId}\n${packId}`
    const key = this.keyOf.get(`${PREVIEW}${name}`) ?? randomBytes(24).toString('base64url')
    const { pack, problems } = readPack(folder, packId, addressFor(`${PREVIEW}${key}`))
    if (pack === undefined) throw new InvalidPacksError(`the pack "${packId}" has ${problems.length} problem(s)`, problems.map(problem => ({ path: problem.file, message: problem.message })))
    this.keyOf.set(`${PREVIEW}${name}`, key)
    this.keys.set(key, `${PREVIEW}${key}`)
    this.previews.set(key, { folder, pack: packId })
    return { pack: describePack(pack, key), view: await previewViewOf(world, (this.deps.wall ?? Date.now)()) }
  }

  private session(id: string): { folder: string; session: ViewSession } {
    if (!isSessionId(id) || !existsSync(sessionDatabase(this.sessions(), id))) throw new SessionNotFoundError(`no session "${id}"`)
    return { folder: sessionFolder(this.sessions(), id), session: this.deps.open(id) }
  }

  /** The pack the session uses, read afresh. */
  active(id: string): ActivePack {
    const { folder } = this.session(id)
    return activePack(folder, this.deps.root(), liveSettings(folder).interface.pack, () => addressFor(id))
  }

  describe(id: string): InterfacePayload {
    const active = this.active(id)
    return { pack: active.pack === undefined ? null : describePack(active.pack, this.frameKey(id)), problems: active.problems }
  }

  /** The player view, or that it is the one the caller has (`revision`). */
  view(id: string, revision?: string): PlayerViewReply {
    const { folder, session } = this.session(id)
    const settings = liveSettings(folder)
    const view = playerViewOf(session, { zone: zoneOf(settings.clock), wall: (this.deps.wall ?? Date.now)() })
    return revision !== undefined && revision === view.revision ? { unchanged: true } : { view }
  }

  /** What the settings of a story show: the pack in use, the packs it could use, and how the world's packs compare with its copies. */
  async status(id: string): Promise<InterfaceStatus> {
    const { folder, session } = this.session(id)
    const root = this.deps.root()
    const active = this.active(id)
    const choice = (base: string, from: PackChoice['from']) => (name: string): PackChoice => {
      const { pack, problems } = readPack(join(base, PACKS_FOLDER, name), name, file => file)
      return { id: name, name: pack?.manifest.name ?? name, from, surfaces: pack === undefined ? [] : Object.keys(pack.manifest.surfaces) as SurfaceName[], problems }
    }
    const own = packIds(folder)
    const available = [...own.map(choice(folder, 'story')), ...packIds(root).filter(name => !own.includes(name)).map(choice(root, 'root'))]
    const reference = session.metadata.get().world
    const worldDirectory = reference === undefined ? undefined : await this.deps.worldDirectory(reference.id)
    return {
      setting: liveSettings(folder).interface.pack,
      ...(active.pack === undefined ? {} : { active: active.pack.id }),
      problems: active.problems,
      available,
      ...(worldDirectory === undefined || reference === undefined ? {} : {
        world: {
          name: reference.name,
          packs: worldPackStates(worldDirectory, folder).map(({ id: name, state }) => {
            const { pack, problems } = readPack(join(worldDirectory, PACKS_FOLDER, name), name, file => file)
            return { id: name, name: pack?.manifest.name ?? name, state, problems }
          }),
        },
      }),
    }
  }

  /**
   * Brings the world's packs into the story, replacing a copy that differs (the old one goes to the story's `.trash`).
   * @throws {WorldNotFoundError} when the person no longer has the world.
   * @throws {InvalidPacksError} when a pack of the world has problems; nothing is changed then.
   */
  async sync(id: string): Promise<InterfaceSync> {
    const { folder, session } = this.session(id)
    const reference = session.metadata.get().world
    const worldDirectory = reference === undefined ? undefined : await this.deps.worldDirectory(reference.id)
    if (worldDirectory === undefined) throw new WorldNotFoundError('the world this story was started from is not among your worlds any more')
    const { problems, ...result } = syncWorldPacks(worldDirectory, folder)
    if (problems.length > 0) throw new InvalidPacksError(`the interface packs of the world have ${problems.length} problem(s); nothing was changed`, problems)
    return result
  }

  /** The latest turns the player has been through, oldest first, as the story stands now: numbered as played (the number `story.turn` counts), without a turn taken back or one not yet told. */
  history(id: string, limit: number = PACK_LIMITS.history.fallback): HistoryTurn[] {
    const { folder } = this.session(id)
    const timeline = readTimeline(folder)
    const delivered = pathTo(timeline, timeline.head).filter(node => node.output !== undefined)
    return delivered.map((node, index): HistoryTurn => ({
      turn: index + 1,
      player: node.player,
      segments: (node.output?.segments ?? []).map(segment => (segment.type === 'utterance' ? { type: 'utterance' as const, name: segment.name, text: segment.text } : { type: 'narration' as const, text: segment.text })),
      ...(node.output?.ooc === undefined ? {} : { note: node.output.ooc.note }),
    })).slice(-Math.min(Math.max(1, limit), PACK_LIMITS.history.max))
  }

  /** A file of the session's pack; a page of it comes with the bridge. @returns nothing when the pack has no such file. */
  file(id: string, path: string): PackResponse | undefined {
    const pack = id.startsWith(PREVIEW) ? this.previewed(id) : this.active(id).pack
    const found = pack === undefined ? undefined : packFile(pack, path)
    if (found === undefined) return undefined
    return found.mediaType.startsWith('text/html')
      ? { kind: 'page', body: withBridge(readFileSync(found.file, 'utf8')), mediaType: found.mediaType }
      : { kind: 'file', ...found }
  }

  /** The pack of a preview, read afresh. */
  private previewed(id: string): LoadedPack | undefined {
    const shown = this.previews.get(id.slice(PREVIEW.length))
    return shown === undefined ? undefined : readPack(shown.folder, shown.pack, addressFor(id)).pack
  }

  /** What the pack keeps in the session. @throws {RangeError} when a value does not fit. */
  storage(id: string, request: { op: 'get' | 'set' | 'remove'; key: string; value?: unknown }): unknown {
    const { session } = this.session(id)
    const { pack } = this.active(id)
    if (pack === undefined) throw new RangeError('the story uses no pack')
    const store = new PackStorage(session, pack.id)
    if (request.op === 'get') return store.get(request.key)
    if (request.op === 'set') store.set(request.key, request.value)
    else store.remove(request.key)
    return null
  }

  /** Whether any pack with a tab exists in the root, a world or a story. */
  availability(): InterfaceAvailability {
    const root = this.deps.root()
    const inside = (folder: string): string[] => (existsSync(folder) ? readdirSync(folder, { withFileTypes: true }).filter(entry => entry.isDirectory()).map(entry => join(folder, entry.name)) : [])
    return { tab: anyTab([root, ...inside(join(root, 'worlds')), ...inside(join(root, 'sessions'))]) }
  }
}
