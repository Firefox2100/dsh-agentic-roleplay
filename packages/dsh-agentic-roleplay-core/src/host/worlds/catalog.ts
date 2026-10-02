import { join } from 'node:path'
import { Service, type Context } from '@deepseek-ai/cordis'
import type { WorldProblem, WorldsPayload } from '../../shared/worlds.ts'
import type { RoleplayRoot } from '../storage/roleplay-root.ts'
import { scanWorlds, type WorldCover, type WorldRecord } from './scan.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    roleplayWorlds: WorldCatalog
  }
}

interface Snapshot {
  directory: string
  worlds: readonly WorldRecord[]
  problems: readonly WorldProblem[]
  scannedAt: number
}

/** Worlds found under the roleplay root. Read lazily, kept until refreshed or the root moves. */
export class WorldCatalog extends Service {
  private cache: Snapshot | undefined
  private running: { directory: string; promise: Promise<Snapshot> } | undefined
  private queued: Promise<Snapshot> | undefined

  constructor(ctx: Context, private readonly root: RoleplayRoot) {
    super(ctx, 'roleplayWorlds')
  }

  get directory(): string {
    return join(this.root.path, 'worlds')
  }

  async list(options: { refresh?: boolean } = {}): Promise<WorldsPayload> {
    const snapshot = await this.snapshot(options.refresh === true)
    return {
      directory: snapshot.directory,
      worlds: snapshot.worlds.map(record => record.summary),
      problems: snapshot.problems,
      scannedAt: snapshot.scannedAt,
    }
  }

  /** A world known to the catalog, by its id. */
  async find(id: string): Promise<WorldRecord | undefined> {
    const snapshot = await this.snapshot(false)
    return snapshot.worlds.find(record => record.summary.id === id)
  }

  /** Cover of a world known to the catalog; undefined for an unknown id or a world without one. */
  async cover(id: string): Promise<WorldCover | undefined> {
    return (await this.find(id))?.cover
  }

  private snapshot(refresh: boolean): Promise<Snapshot> {
    const directory = this.directory
    if (!refresh) {
      if (this.cache?.directory === directory) return Promise.resolve(this.cache)
      return this.running?.directory === directory ? this.running.promise : this.start(directory)
    }
    if (this.running === undefined) return this.start(directory)
    // A scan already under way may have read folders before the change the
    // caller wants to see, so a refresh waits for it and then scans again.
    this.queued ??= this.running.promise.catch(() => undefined).then(() => {
      this.queued = undefined
      return this.start(this.directory)
    })
    return this.queued
  }

  private start(directory: string): Promise<Snapshot> {
    const run = scanWorlds(directory)
      .then((result): Snapshot => {
        const snapshot = { directory, worlds: result.worlds, problems: result.problems, scannedAt: Date.now() }
        this.cache = snapshot
        return snapshot
      })
      .finally(() => { if (this.running?.promise === run) this.running = undefined })
    this.running = { directory, promise: run }
    return run
  }
}
