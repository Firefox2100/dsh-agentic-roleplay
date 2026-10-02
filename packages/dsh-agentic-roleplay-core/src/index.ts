import type { Context } from '@deepseek-ai/cordis'
import { Config } from './host/config.ts'
import { registerApi } from './host/http/index.ts'
import { RoleplayRoot } from './host/storage/roleplay-root.ts'
import { WorldCatalog } from './host/worlds/catalog.ts'

export { Config } from './host/config.ts'
export const name = 'dsh-agentic-roleplay-core'

export function apply(ctx: Context, config: Config): void {
  const root = new RoleplayRoot(ctx, config.rootPath)
  const worlds = new WorldCatalog(ctx, root)
  registerApi(ctx, worlds)
}
