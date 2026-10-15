import { resolve } from 'node:path'
import { Service, type Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-tools'
import z from '@deepseek-ai/schemastery'
import { createSession, deleteSession, forkSession, type ForkOptions, type ForkSource, listSessions, openSession, removeSnapshot, restoreSnapshot, sessionDatabase, snapshotNames, takeSnapshot, type SessionInit, type SessionListing } from './sessions.ts'
import type { SessionStore, StoreOptions } from './store.ts'
import type { RecallQuery, Recalled } from './memory/recall.ts'
import type { SemanticRanker } from './memory/ranker.ts'
import { poolCandidates } from './memory/recall.ts'
import { createTools, type AgentResolver } from './tools/index.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    roleplayState: RoleplayState
  }
}

export interface Config {
  /** `delete` keeps each session in a single file that can be copied; `wal` allows readers while writing. */
  journalMode: 'delete' | 'wal'
  /**
   * Whether the model-facing tools that change the records are registered too. The reading
   * tools are always there; leave writing off where another agent is responsible for the records.
   */
  writeTools: boolean
}

export const Config: z<Config> = z.object({
  journalMode: z.union(['delete', 'wal'] as const).default('delete'),
  writeTools: z.boolean().default(false),
})

/** A session's repositories. Connections belong to the service, so there is nothing to close. */
export type Session = Omit<SessionStore, 'close' | 'snapshotTo'> & {
  /**
   * {@link SessionStore.recall}, with the over-retrieved pool reranked when a ranker is registered with
   * `roleplayState.rankMemories`. The one call for anything that reminds a character of something.
   */
  recallRanked(query: Omit<RecallQuery, 'characters'>, signal?: AbortSignal, options?: { queryVector?: readonly number[] }): Promise<Recalled[]>
}

/**
 * Roleplay session state for other plugins. It creates and opens sessions
 * under a sessions folder, shares one connection per session, and closes them
 * all when the plugin unloads.
 */
export class RoleplayState extends Service {
  private readonly sessions = new Map<string, { store: SessionStore; session: Session }>()
  private readonly options: StoreOptions
  private readonly resolvers = new Set<AgentResolver>()
  private readonly rankers: SemanticRanker[] = []

  constructor(ctx: Context, config: Partial<Config> = {}) {
    super(ctx, 'roleplayState')
    this.options = { journalMode: config.journalMode ?? 'delete' }
    ctx.effect(() => () => { this.closeAll() }, 'roleplay-state: connections')
    const resolve: AgentResolver = (agentSessionId) => {
      for (const resolver of this.resolvers) {
        const found = resolver(agentSessionId)
        if (found !== undefined) return found
      }
      return undefined
    }
    ctx.inject(['tools'], (scope) => {
      for (const tool of createTools(resolve, { write: config.writeTools ?? false })) scope.tools.register(tool)
    })
  }

  /**
   * Let what characters remember be ranked by meaning, with an embedding model or a reranker
   * from another plugin. The latest one registered is used, by every recall: the tools, and the
   * plugins that run characters through `session.recallRanked`. Where it fails, recall carries on
   * with the cues alone and says so in the log.
   * @returns what removes it again.
   */
  rankMemories(ranker: SemanticRanker): () => void {
    this.rankers.push(ranker)
    return () => { this.rankers.splice(this.rankers.indexOf(ranker), 1) }
  }

  /**
   * Tell the tools which roleplay session an agent works in. The plugin that runs agents
   * calls this with a function from the id of an agent's session to its roleplay session,
   * the turn it is playing and how its characters remember.
   * @returns what removes the binding again.
   */
  bind(resolver: AgentResolver): () => void {
    this.resolvers.add(resolver)
    return () => { this.resolvers.delete(resolver) }
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

  /** Keep a consistent copy of a session's database under a name (a lowercase name of letters, digits and hyphens), replacing one of that name. */
  snapshot(sessionsDir: string, id: string, name: string): void {
    const key = resolve(sessionDatabase(sessionsDir, id))
    const open = this.sessions.get(key)?.store
    if (open !== undefined) { takeSnapshot(sessionsDir, id, name, open); return }
    const store = openSession(sessionsDir, id, this.options)
    try { takeSnapshot(sessionsDir, id, name, store) } finally { store.close() }
  }

  /** The names of the snapshots a session has. */
  snapshots(sessionsDir: string, id: string): string[] {
    return snapshotNames(sessionsDir, id)
  }

  /** Delete a snapshot, if there is one. */
  removeSnapshot(sessionsDir: string, id: string, name: string): void {
    removeSnapshot(sessionsDir, id, name)
  }

  /**
   * Put the database of a session back as it was in a snapshot. The connection is released first, so anything that
   * holds the session from before has to ask for it again: nothing may be using it.
   * @throws {NotFoundError} when there is no such snapshot.
   */
  restore(sessionsDir: string, id: string, name: string): void {
    this.closeSession(sessionsDir, id)
    restoreSnapshot(sessionsDir, id, name, this.options)
  }

  /**
   * Make a new session from a snapshot of another, or from its database as it is (nothing may be writing to it): the new one has
   * a folder of its own with the database, the settings and the snapshots named in `keep`, and its own id and name.
   * @throws {ConflictError} when the new id exists. @throws {NotFoundError} when a snapshot does not exist.
   */
  fork(sessionsDir: string, fromId: string, toId: string, from: { snapshot: string } | { live: true }, options: ForkOptions): void {
    if ('snapshot' in from) { forkSession(sessionsDir, fromId, toId, from, options, this.options); return }
    const open = this.sessions.get(resolve(sessionDatabase(sessionsDir, fromId)))?.store
    const store = open ?? openSession(sessionsDir, fromId, this.options)
    try { forkSession(sessionsDir, fromId, toId, { live: store } satisfies ForkSource, options, this.options) } finally { if (open === undefined) store.close() }
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
      factions: store.factions,
      factionStates: store.factionStates,
      factionMemberships: store.factionMemberships,
      factionRelationships: store.factionRelationships,
      factionIntents: store.factionIntents,
      lore: store.lore,
      intents: store.intents,
      events: store.events,
      memories: store.memories,
      threads: store.threads,
      summaries: store.summaries,
      pendingCommits: store.pendingCommits,
      locations: store.locations,
      placements: store.placements,
      relationships: store.relationships,
      knowledge: store.knowledge,
      consolidation: store.consolidation,
      slots: store.slots,
      items: store.items,
      visualIdentities: store.visualIdentities,
      clock: store.clock,
      variables: store.variables,
      routines: store.routines,
      engagements: store.engagements,
      triggers: store.triggers,
      planMove: (characterId, move) => store.planMove(characterId, move),
      planKnownMove: (characterId, move) => store.planKnownMove(characterId, move),
      move: (characterId, move) => store.move(characterId, move),
      recallIndex: store.recallIndex,
      transaction: fn => store.transaction(fn),
      recall: (query, evidence) => store.recall(query, evidence),
      recallStored: (query, options) => store.recallStored(query, options),
      searchEvents: search => store.searchEvents(search),
      recallCandidates: query => store.recallCandidates(query),
      storedEvidence: (query, queryVector) => store.storedEvidence(query, queryVector),
      recallPool: (query, evidence) => store.recallPool(query, evidence),
      finishRecall: (pool, turn, rerank) => store.finishRecall(pool, turn, rerank),
      recallRanked: async (query, signal, options = {}) => {
        const pool = store.recallPool(query, store.storedEvidence(query, options.queryVector))
        const ranker = this.rankers.at(-1)
        if (ranker === undefined) return store.finishRecall(pool, query.turn)
        try {
          const judged = await ranker({ situation: query.situation, candidates: poolCandidates(pool), ...(signal === undefined ? {} : { signal }) })
          return store.finishRecall(pool, query.turn, judged)
        } catch (error) {
          if (signal?.aborted === true) throw error
          this.ctx.logger.warn(`roleplay-state: reranking memories failed, using retrieval alone: ${error instanceof Error ? error.message : String(error)}`)
          return store.finishRecall(pool, query.turn)
        }
      },
      edit: (edit, options) => store.edit(edit, options),
      runTriggers: options => store.runTriggers(options),
      lapseNotes: (turn, kept) => store.lapseNotes(turn, kept),
      deliverNotes: (notes, clock) => store.deliverNotes(notes, clock),
      records: scope => store.records(scope),
    }
    this.sessions.set(key, { store, session })
    return session
  }

  private closeAll(): void {
    for (const { store } of this.sessions.values()) store.close()
    this.sessions.clear()
  }
}

export const name = '@dsh-agentic-roleplay/state'

export function apply(ctx: Context, config: Config): void {
  new RoleplayState(ctx, config)
}
