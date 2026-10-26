import { basename, join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { isSessionId, type RoleplayState } from '@dsh-agentic-roleplay/state'
import { chatSessionId, roleplaySessionOf } from '../../shared/chat.ts'
import { API_PREFIX } from '../../shared/worlds.ts'
import { SYNC_PASSWORD_REF, type SyncConfig } from '../../shared/sync.ts'
import type { CredentialStore } from '../catalogue/sources.ts'
import type { RoleplayOrchestration } from '../orchestration/service.ts'
import type { WorldCatalog } from '../worlds/catalog.ts'
import { SyncRefusedError } from './errors.ts'
import { UnitGate } from './gate.ts'
import type { SyncApi } from './routes.ts'
import { SyncService } from './service.ts'

export interface SyncWiring {
  config: () => SyncConfig
  root: () => string
  worlds: WorldCatalog
  orchestration: RoleplayOrchestration
  state: Pick<RoleplayState, 'closeSession'>
  /** Makes the session's chat again from the files the session folder now holds, if the session has a chat here. */
  rebuild: (session: string) => Promise<void>
  /** Deletes a session for good, its chat included. */
  remove: (session: string) => Promise<void>
}

/** The folder that a request to the API writes or reads, if it is one of the syncable ones. */
export async function unitsOf(url: URL, worlds: WorldCatalog): Promise<string[]> {
  const path = url.pathname.slice(`/${API_PREFIX}`.length)
  const id = url.searchParams.get('id')
  const units: string[] = []
  // A world's id and a session's id have the same shape, so the route tells which one `id` names.
  if (id !== null && path.startsWith('/sessions') && isSessionId(id)) units.push(`sessions/${id}`)
  else if (id !== null && id !== '' && path.startsWith('/worlds')) {
    const world = await worlds.find(id)
    if (world !== undefined) units.push(`worlds/${basename(world.directory)}`)
  }
  if (path.startsWith('/presets')) units.push('presets')
  if (path.startsWith('/lorebooks')) units.push('lorebooks')
  if (path.startsWith('/avatars') || path.startsWith('/worlds/avatars')) units.push('avatars')
  return units
}

/** Builds the sync service with the gate that keeps a unit untouched while it syncs, and hooks it up to the story's turns. */
export function createSync(ctx: Context, wiring: SyncWiring) {
  const gate = new UnitGate()
  const store = (): CredentialStore | undefined => ctx.get('credentials') as CredentialStore | undefined
  const ref = (): string => wiring.config().passwordRef.trim() || SYNC_PASSWORD_REF
  const sessions = (): string => join(wiring.root(), 'sessions')
  const service = new SyncService({
    root: wiring.root,
    config: wiring.config,
    password: async () => (await store()?.resolve(ref()))?.value,
    gate,
    busy: (session) => {
      const chat = chatSessionId(session)
      if (wiring.orchestration.playing(chat)) return 'a turn is being played'
      if (wiring.orchestration.reflecting(chat)) return 'the characters are reflecting'
      return undefined
    },
    idle: session => wiring.orchestration.quiesce(chatSessionId(session)),
    release: async (session) => { await wiring.orchestration.halt(chatSessionId(session)); wiring.state.closeSession(sessions(), session) },
    pulled: wiring.rebuild,
    remove: wiring.remove,
    changed: async () => { await wiring.worlds.list({ refresh: true }) },
    problem: (message) => { ctx.logger.warn(message) },
  })
  // A turn waits while its story syncs, so the unit is not written into.
  ctx.effect(() => {
    wiring.orchestration.unitFree = async (chat) => {
      const session = roleplaySessionOf(chat)
      if (session !== undefined) await gate.whenFree(`sessions/${session}`)
    }
    return () => { wiring.orchestration.unitFree = () => Promise.resolve() }
  }, 'roleplay: story sync gate')
  ctx.effect(() => { const timer = setInterval(() => { void service.auto() }, 60_000); timer.unref(); return () => { clearInterval(timer) } }, 'roleplay: sync timer')

  const describe = async (requested?: string) => {
    const credentials = store()
    const reference = requested ?? ref()
    if (credentials === undefined) return { configured: false, writable: false, ref: reference }
    const status = await credentials.describe(reference)
    return { configured: status.configured, ...(status.source === undefined ? {} : { source: status.source }), writable: status.writable, ref: reference }
  }
  const api: SyncApi = {
    status: () => service.status(),
    run: only => service.run(only),
    resolve: (unit, side) => service.resolve(unit, side),
    forget: (unit) => { service.forget(unit) },
    restore: (unit) => { service.restore(unit) },
    password: {
      describe,
      keep: async (value, requested) => {
        const credentials = store()
        if (credentials === undefined) throw new SyncRefusedError('this profile has no credential store to keep the password in')
        const reference = requested ?? ref()
        if (value === '') await credentials.unset(reference)
        else await credentials.set(reference, value)
        return await describe(reference)
      },
    },
  }
  return {
    service,
    api,
    gate,
    locked: async (url: URL) => (await unitsOf(url, wiring.worlds)).find(unit => gate.isLocked(unit)),
  }
}
