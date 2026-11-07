import { conflictsOf, type OffloadConfig, type OffloadRole } from '../../shared/offload.ts'

/** The slice of the AI providers' model administration this needs (`ctx.aiModels`); looked up on use, so a profile without it only loses the unloading. */
export interface ModelAdmin {
  operations(route: string): readonly ('status' | 'load' | 'unload')[]
  status(route: string, model: string, signal?: AbortSignal): Promise<{ state: string }>
  unload(route: string, model: string, signal?: AbortSignal): Promise<void>
}

/** A language model as DSH names it: the provider is the route. */
export interface ModelRef {
  provider: string
  model: string
}

export interface ResidencyDeps {
  config: () => OffloadConfig
  admin: () => ModelAdmin | undefined
  problem: (message: string) => void
}

/**
 * Keeps the models that cannot share memory from being loaded together. Before a model of a role is used, the models of the roles that
 * conflict with it are unloaded; the server loads what is asked of it on its own, so nothing is loaded here. Which models may still be
 * resident is only what this process has used since it started or since it unloaded them (a server that was already running is asked
 * once), so a role used again and again costs nothing.
 */
export class ModelResidency {
  private possible = new Set<OffloadRole>(['main', 'embedding', 'reranker', 'decision', 'image', 'speech'])
  private turn: Promise<void> = Promise.resolve()
  private reported = new Set<string>()
  private lastMain: ModelRef | undefined
  private readonly active = new Map<OffloadRole, number>()
  private readonly drained = new Map<OffloadRole, (() => void)[]>()

  constructor(private readonly deps: ResidencyDeps) {}

  /** Whether using `role` ever unloads `other`. */
  conflicts(role: OffloadRole, other: OffloadRole): boolean {
    return conflictsOf(this.deps.config(), role).includes(other)
  }

  /**
   * Makes room for `role`. @param main the chat's own model, which is what `main` stands for; the last one seen is used when a caller does not know it.
   * Never fails: a model that cannot be unloaded is reported once and the work goes on, because the server may well manage on its own.
   */
  async ensure(role: OffloadRole, main?: ModelRef): Promise<void> {
    if (role === 'main' && main !== undefined) this.lastMain = main
    const config = this.deps.config()
    if (conflictsOf(config, role).every(other => !this.possible.has(other))) { this.possible.add(role); return }
    // a model is not unloaded under the calls that are using it (a request that meets a model being shut down fails); waiting here, outside the queue, lets them finish
    for (let busy = this.busy(role); busy.length > 0; busy = this.busy(role)) await Promise.all(busy.map(other => this.idle(other)))
    const done = this.turn.then(async () => {
      for (const victim of conflictsOf(this.deps.config(), role).filter(other => this.possible.has(other) && !this.inUse(other))) await this.unload(victim, config, main ?? this.lastMain)
      this.possible.add(role)
    })
    this.turn = done.catch(() => undefined)
    await done
  }

  /** Switches to `role`, reserves it before another switch can begin, and keeps that model resident for the call. */
  async run<T>(role: OffloadRole, call: () => Promise<T>, main?: ModelRef): Promise<T> {
    if (role === 'main' && main !== undefined) this.lastMain = main
    const ready = this.turn.then(async () => {
      for (let busy = this.busy(role); busy.length > 0; busy = this.busy(role)) await Promise.all(busy.map(other => this.idle(other)))
      const config = this.deps.config()
      for (const victim of conflictsOf(config, role).filter(other => this.possible.has(other) && !this.inUse(other))) await this.unload(victim, config, main ?? this.lastMain)
      this.possible.add(role)
      this.active.set(role, (this.active.get(role) ?? 0) + 1)
    })
    this.turn = ready.catch(() => undefined)
    await ready
    try { return await call() } finally { this.release(role) }
  }

  /** Runs a call that uses a model of `role`, so that the model is not unloaded while the call is on. */
  async using<T>(role: OffloadRole, call: () => Promise<T>): Promise<T> {
    this.active.set(role, (this.active.get(role) ?? 0) + 1)
    try { return await call() } finally { this.release(role) }
  }

  private release(role: OffloadRole): void {
    const left = (this.active.get(role) ?? 1) - 1
    if (left > 0) this.active.set(role, left)
    else {
      this.active.delete(role)
      for (const resume of this.drained.get(role) ?? []) resume()
      this.drained.delete(role)
    }
  }

  private inUse(role: OffloadRole): boolean {
    return (this.active.get(role) ?? 0) > 0
  }

  /** The roles that conflict with `role`, may be resident and have calls on. */
  private busy(role: OffloadRole): OffloadRole[] {
    return conflictsOf(this.deps.config(), role).filter(other => this.possible.has(other) && this.inUse(other))
  }

  private idle(role: OffloadRole): Promise<void> {
    return new Promise((resolve) => { this.drained.set(role, [...this.drained.get(role) ?? [], resolve]) })
  }

  private async unload(role: OffloadRole, config: OffloadConfig, main: ModelRef | undefined): Promise<void> {
    const target = role === 'main' ? (main === undefined ? undefined : { route: main.provider, model: main.model }) : config.models[role]
    if (target === undefined || target.route === '' || target.model === '') {
      this.report(`offload: the ${role} model is not set, so it is not unloaded`)
      this.possible.delete(role)
      return
    }
    const admin = this.deps.admin()
    if (admin === undefined) { this.report('offload: the AI providers plugin offers no model administration, so nothing is unloaded'); this.possible.delete(role); return }
    try {
      const operations = admin.operations(target.route)
      if (!operations.includes('unload')) { this.report(`offload: the route "${target.route}" cannot unload models`); this.possible.delete(role); return }
      if (operations.includes('status') && await this.loaded(admin, target) === false) { this.possible.delete(role); return }
      await admin.unload(target.route, target.model)
      this.possible.delete(role)
    } catch (error) {
      this.report(`offload: could not unload ${target.model} on ${target.route}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  /** Whether the server has the model in memory; a server that cannot say is taken to have it, since unloading what is not there is harmless. */
  private async loaded(admin: ModelAdmin, target: { route: string; model: string }): Promise<boolean> {
    try { return (await admin.status(target.route, target.model)).state !== 'uninitialized' } catch { return true }
  }

  private report(message: string): void {
    if (this.reported.has(message)) return
    this.reported.add(message)
    this.deps.problem(message)
  }
}
