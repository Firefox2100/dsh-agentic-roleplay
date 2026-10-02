import { resolve } from 'node:path'
import { Service, type Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { createSession, deleteSession, listSessions, openSession, sessionDatabase, type SessionInit, type SessionListing } from './sessions.ts'
import type { SessionStore, StoreOptions } from './store.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    roleplayState: RoleplayState
  }
}

export interface Config {
  /** `delete` keeps each session in a single file that can be copied; `wal` allows readers while writing. */
  journalMode: 'delete' | 'wal'
}

export const Config: z<Config> = z.object({
  journalMode: z.union(['delete', 'wal'] as const).default('delete'),
})

/** A session's repositories. Connections belong to the service, so there is nothing to close. */
export type Session = Omit<SessionStore, 'close'>

/**
 * Roleplay session state for other plugins. It creates and opens sessions
 * under a sessions folder, shares one connection per session, and closes them
 * all when the plugin unloads.
 */
export class RoleplayState extends Service {
  private readonly sessions = new Map<string, { store: SessionStore; session: Session }>()
  private readonly options: StoreOptions

  constructor(ctx: Context, config: Config) {
    super(ctx, 'roleplayState')
    this.options = { journalMode: config.journalMode }
    ctx.effect(() => () => { this.closeAll() }, 'roleplay-state: connections')
  }

  /**
   * Create a session and open it. Its id is `init.id` or a generated UUID, and is in `metadata.get().id`.
   * @throws {ConflictError} when a session with that id exists.
   */
  createSession(sessionsDir: string, init: SessionInit): Session {
    const store = createSession(sessionsDir, init, this.options)
    return this.track(resolve(sessionDatabase(sessionsDir, store.metadata.get().id)), store)
  }

  /** @throws {NotFoundError} when the session does not exist. */
  openSession(sessionsDir: string, id: string): Session {
    const key = resolve(sessionDatabase(sessionsDir, id))
    return this.sessions.get(key)?.session ?? this.track(key, openSession(sessionsDir, id, this.options))
  }

  /** The metadata of every session under the folder; sessions that cannot be read are reported, not thrown. */
  listSessions(sessionsDir: string): SessionListing {
    return listSessions(sessionsDir, this.options, id => this.sessions.get(resolve(sessionDatabase(sessionsDir, id)))?.store)
  }

  /** Release a session's connection; opening it again reconnects. */
  closeSession(sessionsDir: string, id: string): void {
    const key = resolve(sessionDatabase(sessionsDir, id))
    this.sessions.get(key)?.store.close()
    this.sessions.delete(key)
  }

  /** Close a session and remove its folder, including everything else kept in it. */
  deleteSession(sessionsDir: string, id: string): void {
    this.closeSession(sessionsDir, id)
    deleteSession(sessionsDir, id)
  }

  private track(key: string, store: SessionStore): Session {
    const session: Session = {
      metadata: store.metadata,
      characters: store.characters,
      characterStates: store.characterStates,
      intents: store.intents,
      transaction: fn => store.transaction(fn),
    }
    this.sessions.set(key, { store, session })
    return session
  }

  private closeAll(): void {
    for (const { store } of this.sessions.values()) store.close()
    this.sessions.clear()
  }
}

export const name = 'dsh-roleplay-state'

export function apply(ctx: Context, config: Config): void {
  new RoleplayState(ctx, config)
}
