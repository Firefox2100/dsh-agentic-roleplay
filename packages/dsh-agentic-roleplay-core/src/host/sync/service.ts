import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, rename, rm } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, dirname, isAbsolute, join, normalize, relative } from 'node:path'
import { isSessionId } from '@dsh-agentic-roleplay/state'
import type { SyncConfig, SyncKind, SyncRunResult, SyncSide, SyncState, SyncStatus, SyncUnitStatus } from '../../shared/sync.ts'
import { RcloneError, SyncRefusedError } from './errors.ts'
import type { UnitGate } from './gate.ts'
import { spawnRclone, why, type Rclone, type RcloneSetup } from './rclone.ts'
import { readStore, syncFolder, writeStore, type SyncStore, type UnitRecord } from './state.ts'
import { SHARED_UNITS, conflictFiles, fingerprint, kindOf, localUnits, modeOf } from './units.ts'

export interface SyncDeps {
  root: () => string
  config: () => SyncConfig
  /** The password of the rclone configuration file, if it has one. */
  password: () => Promise<string | undefined>
  gate: UnitGate
  /** Why a session cannot be synced now (a turn is running), or nothing. */
  busy: (session: string) => string | undefined
  /** Resolves once nothing of the session writes to its files in the background any more (the record keeper, the suggestions). */
  idle: (session: string) => Promise<void>
  /** Called before a session's files are replaced: closes its database and stops what its chat has in flight. */
  release: (session: string) => Promise<void>
  /** Called after a session's files were replaced: its chat is made again from them. */
  pulled: (session: string) => Promise<void>
  /** Deletes a session for good, its chat included; called when another device deleted it. */
  remove: (session: string) => Promise<void>
  /** Called after the files of a world or a shared folder changed here. */
  changed: (unit: string) => Promise<void>
  problem: (message: string) => void
  /** Replaces the rclone runner; for tests. */
  rclone?: (setup: RcloneSetup) => Rclone
  now?: () => Date
}

interface Revision {
  rev: string
  device: string
  at: string
  /** False while the device is still uploading; nobody pulls a copy that is not complete. */
  complete: boolean
}

const DIVERGED: Record<string, string | undefined> = {
  none: undefined,
  first: 'both sides have this and it was never synced here',
  both: 'both sides changed it',
  removed: 'removed on this device but still on the remote',
  deleted: 'deleted on another device, and changed here since',
}

const BISYNC = ['--resilient', '--recover', '--conflict-resolve', 'none', '--create-empty-src-dirs', '--max-lock', '5m']

/** The longest name rclone's file system allows for a file bisync keeps per pair of paths, which is made from both paths. */
const BISYNC_NAME_LIMIT = 230

function expand(path: string): string {
  const value = path.trim()
  return value === '~' ? homedir() : value.startsWith('~/') ? join(homedir(), value.slice(2)) : value
}

/**
 * Syncs the roleplay root with a remote through rclone, one unit at a time: a world's folder, a session's folder, or one of the shared
 * folders. A unit is locked while it syncs. Sessions move whole, and when both sides changed one the person chooses which wins; the
 * other units go through bisync file by file, and a file both sides changed is left as two copies for the person to choose from.
 */
export class SyncService {
  private active = false

  constructor(private readonly deps: SyncDeps) {}

  /** Why sync cannot run with the settings as they are, or nothing. */
  problem(): string | undefined {
    const config = this.deps.config()
    if (config.remote.trim() === '') return 'sync is off: no remote is set'
    if (config.configFile.trim() === '') return 'the rclone configuration file is not set'
    const file = expand(config.configFile)
    if (!isAbsolute(file)) return 'the rclone configuration file must be an absolute path'
    const inside = relative(this.deps.root(), normalize(file))
    if (inside === '' || (!inside.startsWith('..') && !isAbsolute(inside))) return 'the rclone configuration file must be outside the roleplay root, or it would be synced'
    if (!existsSync(file)) return `the rclone configuration file does not exist: ${file}`
    return undefined
  }

  get running(): boolean {
    return this.active
  }

  async status(): Promise<SyncStatus> {
    const root = this.deps.root()
    const store = readStore(root)
    const ids = new Set([...(await localUnits(root)), ...Object.keys(store.units), ...store.ignored])
    const units: SyncUnitStatus[] = []
    for (const id of [...ids].sort((left, right) => left.localeCompare(right))) {
      const kind = kindOf(id)
      if (kind === undefined) continue
      units.push(store.ignored.includes(id) ? { id, kind, state: 'ignored', message: 'deleted here and kept on the remote; it is not brought back' } : await this.describe(root, id, kind, store.units[id]))
    }
    const problem = this.problem()
    return { ...(problem === undefined ? {} : { problem }), running: this.active, ...(store.lastRun === undefined ? {} : { lastRun: store.lastRun }), units }
  }

  private async describe(root: string, id: string, kind: SyncKind, record: UnitRecord | undefined): Promise<SyncUnitStatus> {
    const base = { id, kind, ...(record?.at === undefined ? {} : { at: record.at }) }
    const directory = join(root, id)
    // A run writes the folder while it is read, so a file can vanish halfway: that is a change.
    const reading = async <T>(read: () => Promise<T>, otherwise: T): Promise<T> => {
      try { return await read() } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return otherwise; throw error }
    }
    const conflicts = existsSync(directory) && modeOf(kind) === 'files' ? await reading(() => conflictFiles(directory), []) : []
    const removal = record?.diverged === 'removed' || record?.diverged === 'deleted' ? record.diverged : undefined
    const gone = !existsSync(directory) && (record?.at !== undefined || record?.base !== undefined)
    const state = async (): Promise<SyncState> => {
      if (this.deps.gate.isLocked(id)) return 'busy'
      if (conflicts.length > 0 || record?.diverged !== undefined) return 'conflict'
      if (record?.failed !== undefined) return 'failed'
      if (gone) return 'changed'
      if (record?.fingerprint === undefined || !existsSync(directory)) return 'new'
      const print = await reading(() => fingerprint(directory), undefined)
      return print === record.fingerprint ? 'synced' : 'changed'
    }
    const message = record?.failed ?? DIVERGED[record?.diverged ?? 'none'] ?? (gone ? 'removed on this device; the next run asks what to do' : undefined)
    return { ...base, state: await state(), ...(message === undefined ? {} : { message }), ...(conflicts.length > 0 ? { conflicts } : {}), ...(removal === undefined ? {} : { removal }) }
  }

  /**
   * Syncs every unit (or only `only`) that is not busy. A unit that cannot be synced is reported and the others go on.
   * @throws {SyncRefusedError} when sync is off or misconfigured, or a run is under way.
   */
  async run(only?: readonly string[]): Promise<SyncRunResult> {
    const problem = this.problem()
    if (problem !== undefined) throw new SyncRefusedError(problem)
    if (this.active) throw new SyncRefusedError('a sync is already running')
    this.active = true
    try {
      const rclone = await this.client()
      const root = this.deps.root()
      const store = readStore(root)
      const remote = await this.remoteUnits(rclone)
      const deleted = new Set(await this.tombstones(rclone))
      const local = await localUnits(root)
      const wanted = (id: string): boolean => !store.ignored.includes(id) && (only === undefined || only.includes(id))
      const ids = [...new Set([...local, ...remote, ...deleted])].filter(wanted).sort((left, right) => left.localeCompare(right))
      for (const id of ids) {
        if (deleted.has(id)) await this.syncDeleted(id, local.includes(id))
        else await this.syncUnit(rclone, id, local.includes(id), remote.includes(id))
      }
      const after = readStore(root)
      after.lastRun = this.now()
      writeStore(root, after)
      return { units: (await this.status()).units.filter(unit => ids.includes(unit.id)) }
    } finally {
      this.active = false
    }
  }

  /** Runs when the interval has passed since the last run; the caller calls it on a timer. */
  async auto(): Promise<void> {
    const minutes = this.deps.config().intervalMinutes
    if (minutes <= 0 || this.active || this.problem() !== undefined) return
    const last = readStore(this.deps.root()).lastRun
    if (last !== undefined && Date.now() - Date.parse(last) < minutes * 60_000) return
    await this.run().catch((error: unknown) => { this.deps.problem(`sync: ${error instanceof Error ? error.message : String(error)}`) })
  }

  /**
   * Settles a conflict by taking one side whole (a session, or a unit never synced here) or, for a file both sides changed, that side's copy.
   * @throws {SyncRefusedError} when the unit has nothing to choose or is busy.
   */
  async resolve(id: string, side: SyncSide): Promise<SyncUnitStatus | undefined> {
    const problem = this.problem()
    if (problem !== undefined) throw new SyncRefusedError(problem)
    const kind = kindOf(id)
    if (kind === undefined) throw new SyncRefusedError(`"${id}" is not a unit`)
    if (this.active) throw new SyncRefusedError('a sync is running; choose when it is over')
    const root = this.deps.root()
    const directory = join(root, id)
    const conflicts = existsSync(directory) && modeOf(kind) === 'files' ? await conflictFiles(directory) : []
    const record = readStore(root).units[id]
    if (conflicts.length === 0 && record?.diverged === undefined) throw new SyncRefusedError(`"${id}" has nothing to choose`)
    if (kind === 'session') {
      const reason = this.deps.busy(id.slice('sessions/'.length))
      if (reason !== undefined) throw new SyncRefusedError(`"${id}" cannot be changed now: ${reason}`)
    }
    this.active = true
    try {
      const rclone = await this.client()
      await this.guard(id, kind, async () => {
        if (conflicts.length > 0) {
          await this.keepCopies(directory, conflicts, side)
          await this.bisync(rclone, id, false)
        } else if (record?.diverged === 'removed') {
          if (side === 'local') await this.erase(rclone, id, kind)
          else await this.bring(rclone, id, kind)
        } else if (record?.diverged === 'deleted') {
          if (side === 'remote') await this.removeLocal(id, kind)
          else {
            await this.clearTombstone(rclone, id)
            await this.bring(rclone, id, kind, 'local')
          }
        } else await this.bring(rclone, id, kind, side)
      })
    } finally {
      this.active = false
    }
    return (await this.status()).units.find(unit => unit.id === id)
  }

  /** Makes one side the unit's content: the remote's copy is downloaded, or this device's is uploaded. */
  private async bring(rclone: Rclone, id: string, kind: SyncKind, side: SyncSide = 'remote'): Promise<void> {
    const directory = join(this.deps.root(), id)
    if (modeOf(kind) === 'whole') {
      if (side === 'local') await this.push(rclone, id)
      else await this.pull(rclone, id, await this.revision(rclone, id))
      return
    }
    const remote = this.remotePath(id)
    if (side === 'remote') await mkdir(dirname(directory), { recursive: true })
    await this.mirror(rclone, side === 'local' ? directory : remote, side === 'local' ? remote : directory)
    await this.bisync(rclone, id, true)
  }

  /**
   * Deletes a session or a world from the remote: a tombstone is written first, so that no device brings it back while the data is
   * going, and every device that syncs later deletes its own copy.
   * @throws {SyncRefusedError} when sync is off or running, or the unit is not a session or a world.
   */
  async deleteRemote(id: string): Promise<void> {
    const problem = this.problem()
    if (problem !== undefined) throw new SyncRefusedError(problem)
    const kind = kindOf(id)
    if (kind !== 'session' && kind !== 'world') throw new SyncRefusedError(`"${id}" is not a session or a world`)
    if (this.active) throw new SyncRefusedError('a sync is running; delete when it is over')
    this.active = true
    try {
      await this.erase(await this.client(), id, kind)
    } finally {
      this.active = false
    }
  }

  private async erase(rclone: Rclone, id: string, kind: SyncKind): Promise<void> {
    await this.writeTombstone(rclone, id)
    const purged = await rclone.run(['purge', this.remotePath(id)])
    if (purged.code !== 0 && purged.code !== 3) throw new RcloneError(`the remote copy of ${id} is marked deleted but could not be removed: ${why(purged)}`, purged.code)
    if (kind === 'session') await rclone.run(['deletefile', this.revisionPath(id)])
    this.drop(id)
  }

  /** A unit deleted here only is not brought back from the remote by a later run (the remote copy stays where it is) until `restore`. */
  forget(id: string): void {
    if (kindOf(id) === undefined) throw new SyncRefusedError(`"${id}" is not a unit`)
    const root = this.deps.root()
    const store = readStore(root)
    if (!store.ignored.includes(id)) store.ignored.push(id)
    delete store.units[id]
    writeStore(root, store)
  }

  /** Takes a unit off the ignored list: the next run brings the remote's copy here again. */
  restore(id: string): void {
    this.drop(id)
  }

  private drop(id: string): void {
    const root = this.deps.root()
    const store = readStore(root)
    store.ignored = store.ignored.filter(entry => entry !== id)
    delete store.units[id]
    writeStore(root, store)
  }

  private now(): string {
    return (this.deps.now?.() ?? new Date()).toISOString()
  }

  private async client(): Promise<Rclone> {
    const config = this.deps.config()
    const password = await this.deps.password()
    const setup: RcloneSetup = { binary: expand(config.rclone), configFile: expand(config.configFile), ...(password === undefined ? {} : { password }) }
    return (this.deps.rclone ?? spawnRclone)(setup)
  }

  private remotePath(id: string): string {
    const remote = this.deps.config().remote.trim()
    return remote.endsWith(':') || remote.endsWith('/') ? `${remote}${id}` : `${remote}/${id}`
  }

  private async remoteUnits(rclone: Rclone): Promise<string[]> {
    const listed = async (prefix: string): Promise<string[]> => {
      const base = this.deps.config().remote.trim()
      const path = prefix === '' ? base : this.remotePath(prefix)
      const result = await rclone.run(['lsf', '--dirs-only', path])
      if (result.code === 3) return []
      if (result.code !== 0) throw new RcloneError(`cannot list ${path}: ${why(result)}`, result.code)
      return result.stdout.split('\n').map(line => line.trim().replace(/\/$/, '')).filter(line => line !== '' && !line.startsWith('.'))
    }
    const [top, worlds, sessions] = await Promise.all([listed(''), listed('worlds'), listed('sessions')])
    return [...top.filter(name => (SHARED_UNITS as readonly string[]).includes(name)), ...worlds.map(name => `worlds/${name}`), ...sessions.filter(isSessionId).map(name => `sessions/${name}`)]
  }

  /** Locks the unit, records how it went and never lets one unit's failure stop the run. */
  private async syncUnit(rclone: Rclone, id: string, local: boolean, remote: boolean): Promise<void> {
    const kind = kindOf(id)
    if (kind === undefined) return
    const root = this.deps.root()
    const note = (change: (record: UnitRecord) => void): void => {
      const store = readStore(root)
      const record = store.units[id] ?? {}
      change(record)
      store.units[id] = record
      writeStore(root, store)
    }
    const known = readStore(root).units[id]
    if (!local && remote && (known?.at !== undefined || known?.base !== undefined)) {
      // Deleted here after it had been synced: whether that means everywhere is for the person to say.
      note((record) => { record.diverged = 'removed'; delete record.failed })
      return
    }
    if (kind === 'session') {
      const reason = this.deps.busy(id.slice('sessions/'.length))
      if (reason !== undefined) { note((record) => { record.failed = `skipped: ${reason}` }); return }
    }
    try {
      await this.guard(id, kind, async () => { await (modeOf(kind) === 'whole' ? this.syncWhole(rclone, id, local) : this.syncFiles(rclone, id, local, remote)) })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      note((record) => { record.failed = message })
      this.deps.problem(`sync ${id}: ${message}`)
    }
  }

  /** Another device deleted the unit: this device's copy goes too, unless it was never synced here or changed since, which is for the person to decide. */
  private async syncDeleted(id: string, local: boolean): Promise<void> {
    const kind = kindOf(id)
    if (kind !== 'session' && kind !== 'world') return
    if (!local) { this.drop(id); return }
    const record = readStore(this.deps.root()).units[id]
    const synced = record?.at !== undefined || record?.base !== undefined
    const changed = synced && (await fingerprint(join(this.deps.root(), id))) !== record.fingerprint
    if (!synced || changed) { await this.record(id, (entry) => { entry.diverged = 'deleted'; delete entry.failed }); return }
    if (kind === 'session') {
      const reason = this.deps.busy(id.slice('sessions/'.length))
      if (reason !== undefined) { await this.record(id, (entry) => { entry.failed = `deleted on another device; skipped: ${reason}` }); return }
    }
    try {
      await this.guard(id, kind, async () => { await this.removeLocal(id, kind) })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      await this.record(id, (entry) => { entry.failed = message })
      this.deps.problem(`sync ${id}: ${message}`)
    }
  }

  /** A session is deleted like any other; a world's folder is moved to the root's trash, which is emptied after a while. */
  private async removeLocal(id: string, kind: SyncKind): Promise<void> {
    if (kind === 'session') await this.deps.remove(id.slice('sessions/'.length))
    else {
      const trash = join(this.deps.root(), '.trash', 'worlds')
      await mkdir(trash, { recursive: true })
      await rename(join(this.deps.root(), id), join(trash, `${basename(id)}-${Date.now()}`))
    }
    this.drop(id)
  }

  private tombstonePath(id: string): string {
    return this.remoteFile(`.tombstones/${encodeURIComponent(id)}.json`)
  }

  private async tombstones(rclone: Rclone): Promise<string[]> {
    const result = await rclone.run(['lsf', '--files-only', this.remoteFile('.tombstones')])
    if (result.code === 3) return []
    if (result.code !== 0) throw new RcloneError(`cannot list the deleted units: ${why(result)}`, result.code)
    return result.stdout.split('\n').map(line => line.trim()).filter(line => line.endsWith('.json')).map(line => decodeURIComponent(line.slice(0, -'.json'.length)))
  }

  private async writeTombstone(rclone: Rclone, id: string): Promise<void> {
    const result = await rclone.run(['rcat', this.tombstonePath(id)], { input: JSON.stringify({ device: readStore(this.deps.root()).device, at: this.now() }) })
    if (result.code !== 0) throw new RcloneError(`cannot mark ${id} deleted on the remote: ${why(result)}`, result.code)
  }

  private async clearTombstone(rclone: Rclone, id: string): Promise<void> {
    const result = await rclone.run(['deletefile', this.tombstonePath(id)])
    if (result.code !== 0 && result.code !== 3 && result.code !== 4) throw new RcloneError(`cannot remove the deletion mark of ${id}: ${why(result)}`, result.code)
  }

  private async guard(id: string, kind: SyncKind, work: () => Promise<void>): Promise<void> {
    await this.deps.gate.hold(id, async () => {
      if (kind === 'session') await this.deps.idle(id.slice('sessions/'.length))
      await work()
      if (kind !== 'session') await this.deps.changed(id)
    })
  }

  private async record(id: string, change: (record: UnitRecord) => void): Promise<void> {
    const root = this.deps.root()
    const store: SyncStore = readStore(root)
    const record = store.units[id] ?? {}
    change(record)
    store.units[id] = record
    writeStore(root, store)
  }

  private async settled(id: string, base?: string): Promise<void> {
    const print = await fingerprint(join(this.deps.root(), id))
    await this.record(id, (record) => {
      delete record.failed
      delete record.diverged
      record.fingerprint = print
      record.at = this.now()
      record.ready = true
      if (base !== undefined) record.base = base
    })
  }

  private remoteFile(file: string): string {
    const remote = this.deps.config().remote.trim()
    return remote.endsWith(':') || remote.endsWith('/') ? `${remote}${file}` : `${remote}/${file}`
  }

  private revisionPath(id: string): string {
    return this.remoteFile(`.revisions/${id.replaceAll('/', '__')}.json`)
  }

  private async revision(rclone: Rclone, id: string): Promise<Revision | undefined> {
    const result = await rclone.run(['cat', this.revisionPath(id)])
    if (result.code === 3 || result.code === 4) return undefined
    if (result.code !== 0) throw new RcloneError(`cannot read the revision of ${id}: ${why(result)}`, result.code)
    return JSON.parse(result.stdout) as Revision
  }

  private async writeRevision(rclone: Rclone, id: string, revision: Revision): Promise<void> {
    const result = await rclone.run(['rcat', this.revisionPath(id)], { input: JSON.stringify(revision) })
    if (result.code !== 0) throw new RcloneError(`cannot write the revision of ${id}: ${why(result)}`, result.code)
  }

  private async mirror(rclone: Rclone, from: string, to: string): Promise<void> {
    const result = await rclone.run(['sync', from, to, '--checksum', '--create-empty-src-dirs'])
    if (result.code !== 0) throw new RcloneError(`rclone sync failed: ${why(result)}`, result.code)
  }

  /** A session moves whole. A revision says which upload a copy came from, so a change on one side only is told from a change on both. */
  private async syncWhole(rclone: Rclone, id: string, local: boolean): Promise<void> {
    const root = this.deps.root()
    const record = readStore(root).units[id]
    const remote = await this.revision(rclone, id)
    if (!local) {
      if (remote !== undefined) await this.pull(rclone, id, remote)
      return
    }
    if (remote === undefined) { await this.push(rclone, id); return }
    // An upload of this device that was cut short: the local copy is the one that was being sent.
    if (!remote.complete && remote.device === readStore(root).device) { await this.push(rclone, id); return }
    const changedHere = record?.fingerprint === undefined || (await fingerprint(join(root, id))) !== record.fingerprint
    const changedThere = record?.base !== remote.rev
    if (!changedHere && !changedThere) {
      if (record?.chat === 'stale') await this.rebuildChat(id)
      else await this.settled(id)
      return
    }
    if (changedThere && !changedHere) { await this.pull(rclone, id, remote); return }
    if (!changedThere) { await this.push(rclone, id); return }
    await this.record(id, (entry) => { entry.diverged = record?.base === undefined ? 'first' : 'both'; delete entry.failed })
  }

  private async push(rclone: Rclone, id: string): Promise<void> {
    // Closing the session's database writes whatever its journal still holds into the file that is about to be copied.
    if (kindOf(id) === 'session') await this.deps.release(id.slice('sessions/'.length))
    const revision: Revision = { rev: randomUUID(), device: readStore(this.deps.root()).device, at: this.now(), complete: false }
    await this.writeRevision(rclone, id, revision)
    await this.mirror(rclone, join(this.deps.root(), id), this.remotePath(id))
    await this.writeRevision(rclone, id, { ...revision, complete: true })
    await this.settled(id, revision.rev)
  }

  private async pull(rclone: Rclone, id: string, remote: Revision | undefined): Promise<void> {
    if (remote === undefined) throw new SyncRefusedError(`the remote has no copy of "${id}"`)
    if (!remote.complete) throw new SyncRefusedError(`the copy of "${id}" on the remote is still being uploaded; try again later`)
    const session = id.slice('sessions/'.length)
    await this.deps.release(session)
    const directory = join(this.deps.root(), id)
    await mkdir(directory, { recursive: true })
    await this.mirror(rclone, this.remotePath(id), directory)
    await this.settled(id, remote.rev)
    await this.rebuildChat(id)
  }

  /** The chat is made again from the files, which changes them (its timeline is renumbered), so what the folder looks like is recorded after it. */
  private async rebuildChat(id: string): Promise<void> {
    await this.record(id, (record) => { record.chat = 'stale' })
    await this.deps.pulled(id.slice('sessions/'.length))
    await this.settled(id)
    await this.record(id, (record) => { delete record.chat })
  }

  private async syncFiles(rclone: Rclone, id: string, local: boolean, remote: boolean): Promise<void> {
    const directory = join(this.deps.root(), id)
    if (!local && !remote) return
    if (!local) {
      await mkdir(dirname(directory), { recursive: true })
      await this.mirror(rclone, this.remotePath(id), directory)
      await this.bisync(rclone, id, true)
      return
    }
    if (!remote) {
      await this.mirror(rclone, directory, this.remotePath(id))
      await this.bisync(rclone, id, true)
      return
    }
    if (readStore(this.deps.root()).units[id]?.ready !== true) {
      const same = await rclone.run(['check', directory, this.remotePath(id), '--one-way'])
      const other = await rclone.run(['check', this.remotePath(id), directory, '--one-way'])
      if (same.code === 0 && other.code === 0) await this.bisync(rclone, id, true)
      else await this.record(id, (record) => { record.diverged = 'first'; delete record.failed })
      return
    }
    await this.bisync(rclone, id, false)
  }

  /** `baseline` makes the two sides the starting point of later runs; it is only used when they are known to be the same. */
  private async bisync(rclone: Rclone, id: string, baseline: boolean): Promise<void> {
    const directory = join(this.deps.root(), id)
    if (directory.length + this.remotePath(id).length + 30 > BISYNC_NAME_LIMIT) throw new SyncRefusedError('the paths of the data folder and the remote are too long for rclone to keep its records of them: use shorter folder names')
    const result = await rclone.run(['bisync', directory, this.remotePath(id), '--workdir', join(syncFolder(this.deps.root()), 'bisync'), ...BISYNC, ...(baseline ? ['--resync'] : [])])
    if (result.code !== 0) throw new RcloneError(`rclone bisync failed: ${why(result)}`, result.code)
    const conflicts = await conflictFiles(directory)
    if (conflicts.length > 0) {
      await this.record(id, (record) => { delete record.failed; record.ready = true; record.at = this.now() })
      return
    }
    await this.settled(id)
  }

  /** For each file two copies were kept of: the chosen side's copy takes the file's name and the other is removed. */
  private async keepCopies(directory: string, conflicts: readonly string[], side: SyncSide): Promise<void> {
    const keep = side === 'local' ? 'conflict1' : 'conflict2'
    for (const path of conflicts) {
      const original = path.replace(/\.conflict[12]$/, '')
      if (path.endsWith(keep)) {
        await rm(join(directory, original), { force: true })
        await rename(join(directory, path), join(directory, original))
      } else await rm(join(directory, path), { force: true })
    }
  }
}
