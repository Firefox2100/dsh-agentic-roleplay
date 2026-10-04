import { existsSync } from 'node:fs'
import type { CharacterId, Move, MovePlan, NewSession, StoryEvent } from 'dsh-roleplay-model'
import { moveCharacter, planMove } from './records/movement.ts'
import { systemClock, type Clock } from './clock.ts'
import { nodeSqliteDriver } from './driver/node-sqlite.ts'
import type { OpenOptions, SqlDatabase, SqlDriver } from './driver/types.ts'
import { ConflictError, NotFoundError, SchemaError } from './errors.ts'
import type {
  ClockRepository, EngagementRepository, RoutineRepository, CharacterRepository, CharacterStateRepository, EventRepository, IntentRepository, MemoryRepository, MetadataRepository,
  ConsolidationRepository, ItemRepository, LocationRepository, PendingCommitRepository, RelationshipRepository, PlacementRepository, RecallIndexRepository, SlotRepository, SummaryRepository, ThreadRepository, VectorSupport,
} from './repositories.ts'
import { denseScore, finishRecall, recall, recallCandidates, recallPool, type RecallPool, type MemoryPolicy, type RecallCandidate, type RecallEvidence, type RecallQuery, type Recalled } from './memory/recall.ts'
import { applyRecordsEdit, type EditResult, type RecordsEdit } from './records/edit.ts'
import { readRecords, type RecordsScope, type RecordsView } from './records/read.ts'
import { SqliteEventRepository } from './sqlite/event-repository.ts'
import { SqliteMemoryRepository } from './sqlite/memory-repository.ts'
import { SqlitePendingCommitRepository, SqliteSummaryRepository, SqliteThreadRepository } from './sqlite/narrative-repositories.ts'
import { SqliteRecallIndex } from './sqlite/recall-index.ts'
import { SqliteEngagementRepository, SqliteRoutineRepository } from './sqlite/agenda-repositories.ts'
import { SqliteClockRepository } from './sqlite/clock-repository.ts'
import { SqliteItemRepository, SqliteSlotRepository } from './sqlite/item-repository.ts'
import { SqliteConsolidationRepository, SqliteRelationshipRepository } from './sqlite/relationship-repository.ts'
import { SqliteLocationRepository, SqlitePlacementRepository } from './sqlite/location-repository.ts'
import { vectorExtension } from './sqlite/vector-extension.ts'
import { SqliteCharacterRepository } from './sqlite/character-repository.ts'
import { SqliteIntentRepository } from './sqlite/intent-repository.ts'
import { SqliteMetadataRepository } from './sqlite/metadata-repository.ts'
import { inspect, migrate } from './sqlite/migrate.ts'
import { APPLICATION_ID, LATEST_VERSION } from './sqlite/schema.ts'
import { SqliteCharacterStateRepository } from './sqlite/state-repository.ts'

export interface StoreOptions extends OpenOptions {
  /** Defaults to the driver on Node's built-in SQLite. */
  driver?: SqlDriver
  /** Supplies the time stamped on rows; defaults to the system clock. */
  clock?: Clock
  /** Whether to load the sqlite-vec extension for vector search. On by default; a session works without it when it is missing. */
  vectors?: boolean
}

/** One session: everything stored about it, reached through repositories. */
export interface SessionStore {
  readonly metadata: MetadataRepository
  readonly characters: CharacterRepository
  readonly characterStates: CharacterStateRepository
  readonly intents: IntentRepository
  readonly events: EventRepository
  readonly memories: MemoryRepository
  readonly threads: ThreadRepository
  readonly summaries: SummaryRepository
  readonly pendingCommits: PendingCommitRepository
  readonly locations: LocationRepository
  readonly placements: PlacementRepository
  readonly relationships: RelationshipRepository
  readonly consolidation: ConsolidationRepository
  readonly slots: SlotRepository
  readonly items: ItemRepository
  /** The story's own time. */
  readonly clock: ClockRepository
  /** The recurring day of each character. */
  readonly routines: RoutineRepository
  /** What characters have committed to, by date. */
  readonly engagements: EngagementRepository
  /** What the session can be searched by: its texts by words, and by meaning once vectors are stored. */
  readonly recallIndex: RecallIndexRepository
  /** Run `fn` atomically across the repositories; see {@link SqlDatabase.transaction}. */
  transaction<T>(fn: () => T): T
  /**
   * What a character is reminded of at this moment: what it took in and believes, chosen by what
   * the situation calls to mind and, with flaky memory, by how much of it is left.
   */
  recall(query: Omit<RecallQuery, 'characters'>, evidence?: RecallEvidence): Recalled[]
  /** The first stage of {@link SessionStore.recall}: retrieve by the cues, the words and the meaning of the moment, fuse, and over-retrieve. */
  recallPool(query: Omit<RecallQuery, 'characters'>, evidence?: Omit<RecallEvidence, 'rerank'>): RecallPool
  /** The last stage: choose the best of a pool, by a reranker's judgement when there is one, and count what is recalled. */
  finishRecall(pool: RecallPool, turn: number, rerank?: ReadonlyMap<string, number>): Recalled[]
  /**
   * What a character is reminded of, using the session's index as well as the cues: texts that match the
   * moment by words, and, when the vector of the moment is given (from the model that made the stored
   * vectors), texts that match it by meaning.
   * @throws {InvalidValueError} when the vector has other dimensions than the stored ones.
   */
  recallStored(query: Omit<RecallQuery, 'characters'>, options?: { queryVector?: readonly number[] }): Recalled[]
  /** What the session's index says about each candidate for a moment: by words, and by meaning when the vector of the moment is given. */
  storedEvidence(query: Omit<RecallQuery, 'characters'>, queryVector?: readonly number[]): Pick<RecallEvidence, 'lexical' | 'dense'>
  /**
   * Look up what happened (not what any character took in) by words and, with a vector, by meaning, best first.
   * The two searches are merged by reciprocal rank, so what ranks well in either comes first.
   */
  searchEvents(search: { text: string; vector?: readonly number[]; limit?: number; fromTurn?: number; toTurn?: number; minImportance?: number; locationId?: number; itemId?: number }): StoryEvent[]
  /** What a character could be reminded of, to be ranked by meaning before {@link recall}. */
  recallCandidates(query: Omit<RecallQuery, 'characters' | 'policy'>): RecallCandidate[]
  /**
   * Change the story's records (state, events and who took them in, beliefs, threads), together or not at all.
   * @throws {InvalidEditError} naming every problem; nothing was written then.
   */
  /** Whether a character can go there, and the way it would take. */
  planMove(characterId: CharacterId, move: Move): ReturnType<typeof planMove>
  /** Move a character: its place changes, at the position or feature given. @throws {InvalidMoveError} naming every reason. */
  move(characterId: CharacterId, move: Move): MovePlan
  /** Apply an edit atomically; with `seal`, the events it adds are final at once (otherwise they stay drafts until sealed). */
  edit(edit: RecordsEdit, options?: { seal?: boolean }): EditResult
  /** Read the records back in the form models read them. */
  records(scope?: RecordsScope): RecordsView
  close(): void
}

/** How many hits of each search are weighed when recalling. */
const STORED_CANDIDATES = 50
/** Reciprocal rank fusion: how much the first places count against the later ones. */
const RANK_OFFSET = 60

class SqliteSessionStore implements SessionStore {
  readonly metadata: SqliteMetadataRepository
  readonly characters: CharacterRepository
  readonly characterStates: CharacterStateRepository
  readonly intents: IntentRepository
  readonly events: EventRepository
  readonly memories: MemoryRepository
  readonly threads: ThreadRepository
  readonly summaries: SummaryRepository
  readonly pendingCommits: PendingCommitRepository
  readonly locations: LocationRepository
  readonly placements: PlacementRepository
  readonly relationships: RelationshipRepository
  readonly consolidation: ConsolidationRepository
  readonly slots: SlotRepository
  readonly items: ItemRepository
  readonly clock: ClockRepository
  readonly routines: RoutineRepository
  readonly engagements: EngagementRepository
  readonly recallIndex: SqliteRecallIndex
  private readonly eventRepository: SqliteEventRepository

  constructor(private readonly db: SqlDatabase, clock: Clock, vectors: VectorSupport) {
    this.metadata = new SqliteMetadataRepository(db, clock)
    this.recallIndex = new SqliteRecallIndex(db, this.metadata, vectors)
    this.characters = new SqliteCharacterRepository(db, clock)
    this.characterStates = new SqliteCharacterStateRepository(db, clock)
    this.intents = new SqliteIntentRepository(db, clock)
    this.locations = new SqliteLocationRepository(db, clock, id => { this.eventRepository.reindexPlace(id) })
    this.placements = new SqlitePlacementRepository(db, this.locations)
    this.relationships = new SqliteRelationshipRepository(db, clock)
    this.consolidation = new SqliteConsolidationRepository(db)
    this.slots = new SqliteSlotRepository(db)
    this.items = new SqliteItemRepository(db, clock)
    this.clock = new SqliteClockRepository(db)
    this.routines = new SqliteRoutineRepository(db)
    this.engagements = new SqliteEngagementRepository(db)
    this.eventRepository = new SqliteEventRepository(db, clock, this.recallIndex, id => this.locations.get(id)?.name, id => this.items.get(id)?.name)
    this.events = this.eventRepository
    this.memories = new SqliteMemoryRepository(db, clock, this.recallIndex)
    this.threads = new SqliteThreadRepository(db, clock)
    this.summaries = new SqliteSummaryRepository(db, clock)
    this.pendingCommits = new SqlitePendingCommitRepository(db, clock)
  }

  transaction<T>(fn: () => T): T {
    return this.db.transaction(fn)
  }

  recallCandidates(query: Omit<RecallQuery, 'characters' | 'policy'>): RecallCandidate[] {
    return recallCandidates(this, { ...query, characters: this.characters.list() })
  }

  recall(query: Omit<RecallQuery, 'characters'>, evidence?: RecallEvidence): Recalled[] {
    return this.finishRecall(this.recallPool(query, evidence), query.turn, evidence?.rerank)
  }

  recallPool(query: Omit<RecallQuery, 'characters'>, evidence?: Omit<RecallEvidence, 'rerank'>): RecallPool {
    return recallPool(this, { ...query, characters: this.characters.list() }, evidence)
  }

  finishRecall(pool: RecallPool, turn: number, rerank?: ReadonlyMap<string, number>): Recalled[] {
    const found = finishRecall(pool, rerank)
    this.events.touchPerceptions(found.flatMap(entry => (entry.source.kind === 'perception' ? [entry.source.id] : [])), turn)
    this.memories.touch(found.flatMap(entry => (entry.source.kind === 'memory' ? [entry.source.id] : [])), turn)
    return found
  }

  storedEvidence(query: Omit<RecallQuery, 'characters'>, queryVector?: readonly number[]): Pick<RecallEvidence, 'lexical' | 'dense'> {
    const found = (hits: { key: string; score: number }[], map: (score: number) => number = score => score): ReadonlyMap<string, number> =>
      new Map(hits.map(hit => [hit.key, map(hit.score)]))
    const lexical = found(this.recallIndex.lexical({ text: query.situation, characterId: query.characterId, kinds: ['perception', 'memory'], limit: STORED_CANDIDATES }))
    const dense = queryVector === undefined ? undefined : found(this.recallIndex.vector({ vector: queryVector, characterId: query.characterId, limit: STORED_CANDIDATES }), denseScore)
    return { lexical, ...(dense === undefined ? {} : { dense }) }
  }

  recallStored(query: Omit<RecallQuery, 'characters'>, options: { queryVector?: readonly number[] } = {}): Recalled[] {
    return this.recall(query, this.storedEvidence(query, options.queryVector))
  }

  searchEvents({ text, vector, limit = 10, fromTurn, toTurn, minImportance, locationId, itemId }: { text: string; vector?: readonly number[]; limit?: number; fromTurn?: number; toTurn?: number; minImportance?: number; locationId?: number; itemId?: number }): StoryEvent[] {
    const lexical = this.recallIndex.lexical({ text, kinds: ['event'], limit: STORED_CANDIDATES })
    const dense = vector === undefined ? [] : this.recallIndex.vector({ vector, characterId: 0, limit: STORED_CANDIDATES })
    const scores = new Map<number, number>()
    for (const hits of [lexical, dense]) hits.forEach((hit, rank) => { scores.set(hit.refId, (scores.get(hit.refId) ?? 0) + 1 / (RANK_OFFSET + rank)) })
    return [...scores].sort((a, b) => b[1] - a[1]).flatMap(([id]) => {
      const event = this.events.get(id)
      if (event === undefined) return []
      if ((fromTurn !== undefined && event.turn < fromTurn) || (toTurn !== undefined && event.turn > toTurn) || (minImportance !== undefined && event.importance < minImportance) || (locationId !== undefined && event.locationId !== locationId) || (itemId !== undefined && !event.items.includes(itemId))) return []
      return [event]
    }).slice(0, limit)
  }

  planMove(characterId: CharacterId, move: Move): ReturnType<typeof planMove> {
    return planMove(this, characterId, move)
  }

  move(characterId: CharacterId, move: Move): MovePlan {
    return this.transaction(() => moveCharacter(this, characterId, move))
  }

  edit(edit: RecordsEdit, options: { seal?: boolean } = {}): EditResult {
    return this.transaction(() => {
      const result = applyRecordsEdit(this, edit)
      if (options.seal === true) this.events.seal(result.eventIds)
      return result
    })
  }

  records(scope?: RecordsScope): RecordsView {
    return readRecords(this, scope)
  }

  close(): void {
    this.db.close()
  }
}

/** Open the database, with the vector extension when there is one; without it the session still works, minus vector search. */
function connect(location: string, options: StoreOptions): { db: SqlDatabase; vectors: VectorSupport } {
  const { driver = nodeSqliteDriver, clock: _clock, vectors: wanted = true, ...open } = options
  if (!wanted) return { db: driver.open(location, open), vectors: { available: false, error: 'switched off' } }
  const extension = vectorExtension()
  if ('error' in extension) return { db: driver.open(location, open), vectors: { available: false, error: extension.error } }
  try {
    return { db: driver.open(location, { ...open, extensions: [extension.path] }), vectors: { available: true } }
  } catch (error) {
    return { db: driver.open(location, open), vectors: { available: false, error: error instanceof Error ? error.message : String(error) } }
  }
}

/**
 * Create the database of a new session at `location` (the file must not hold a
 * session yet, and its folder must exist).
 * @throws {ConflictError} when the location already holds a session database.
 */
export function createSessionStore(location: string, session: NewSession, options: StoreOptions = {}): SessionStore {
  const { db, vectors } = connect(location, options)
  try {
    if (inspect(db).version > 0) throw new ConflictError(`${location} already holds a session database`)
    migrate(db)
    const store = new SqliteSessionStore(db, options.clock ?? systemClock, vectors)
    store.metadata.create(session)
    store.slots.ensureDefaults()
    return store
  } catch (error) {
    db.close()
    throw error
  }
}

/**
 * Open the database of an existing session, bringing an older schema up to date.
 * @throws {NotFoundError} when there is no file at `location`.
 * @throws {SchemaError} when the file is not a session database, or is from a newer version.
 */
export function openSessionStore(location: string, options: StoreOptions = {}): SessionStore {
  if (location !== ':memory:' && !existsSync(location)) throw new NotFoundError(`no session database at ${location}`)
  const { db, vectors } = connect(location, options)
  try {
    const state = inspect(db)
    if (state.version === 0 || state.applicationId !== APPLICATION_ID) throw new SchemaError(`${location} is not a session database`)
    migrate(db)
    return new SqliteSessionStore(db, options.clock ?? systemClock, vectors)
  } catch (error) {
    db.close()
    throw error
  }
}

export { LATEST_VERSION as SCHEMA_VERSION }
export type { MemoryPolicy }
