import type { Context } from '@deepseek-ai/cordis'
import { resolveRootPath } from '../storage/root-path.ts'
import { purgeChat, type PurgeDeps, type StoredSessions } from './purge.ts'

interface LiveAgent {
  status: string
  session: unknown
  cancel(reason: { kind: 'user' }, options: { keepInbox: boolean }): void
  whenIdle(): Promise<void>
}

/** What DSH's services give and the purge needs, looked up when used: a profile without them cannot delete a chat. */
export function purgeDepsOf(ctx: Context, storePath: string): PurgeDeps {
  const service = <T>(name: string): T | undefined => (ctx.get as unknown as (name: string) => T | undefined)(name)
  return {
    storeRoot: () => resolveRootPath(storePath),
    stored: () => service<StoredSessions>('sessionPersistence'),
    quiet: async (chat) => {
      await ctx.roleplayOrchestration.halt(chat)
      const live = service<{ get(id: string): LiveAgent | undefined }>('agents')?.get(chat)
      if (live === undefined) return
      if (live.status !== 'idle') { live.cancel({ kind: 'user' }, { keepInbox: true }); await live.whenIdle() }
      await service<{ flush(session: unknown): Promise<unknown> }>('sessions')?.flush(live.session)
    },
    removed: (id) => { (ctx as unknown as { emit(name: string, id: string): void }).emit('api-session/removed', id) },
    projection: () => service('sessionProjectionCache'),
  }
}

export const purgeOf = (ctx: Context, storePath: string): ((chat: string) => Promise<unknown>) => chat => purgeChat(purgeDepsOf(ctx, storePath), chat)
