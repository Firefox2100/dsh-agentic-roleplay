import { Service, type Context, type Volatile } from '@deepseek-ai/cordis'
// Type-only: declares the `loader/volatile-update` event.
import type {} from '@deepseek-ai/cordis-plugin-loader'
import { ensureRootLayout, resolveRootPath } from './root-path.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    roleplayRoot: RoleplayRoot
  }
}

/** Owns the roleplay root directory and keeps its baseline layout in place. */
export class RoleplayRoot extends Service {
  private current: string

  /**
   * @param ctx - owning plugin context.
   * @param source - live configured root path.
   * @throws {Error} when the configured path is invalid, so the plugin fails to load.
   */
  constructor(ctx: Context, private readonly source: Volatile<string>) {
    super(ctx, 'roleplayRoot')
    this.current = resolveRootPath(source.get())
    ctx.on('loader/volatile-update', () => this.refresh())
  }

  /** Prepare the configured root after construction. */
  start(): void {
    void this.prepare(this.current)
  }

  /** Absolute path of the active root. */
  get path(): string {
    return this.current
  }

  private refresh(): void {
    let next: string
    try {
      next = resolveRootPath(this.source.get())
    } catch (error) {
      // Keep serving the previous root: a half-typed path must not move live data.
      this.ctx.logger.warn(error)
      return
    }
    if (next === this.current) return
    this.current = next
    void this.prepare(next)
  }

  private async prepare(root: string): Promise<void> {
    try {
      await ensureRootLayout(root)
    } catch (error) {
      this.ctx.logger.error(`cannot prepare roleplay root ${root}`, error)
    }
  }
}
