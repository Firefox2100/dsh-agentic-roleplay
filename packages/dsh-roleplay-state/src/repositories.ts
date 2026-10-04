import type {
  EmbeddingIndexInfo,
  Exit, ExitId, ExitPatch, Location, LocationId, LocationPatch, NewExit, NewLocation, NewPlacement, PlaceableKind, Placement,
  PerceptionId,
  PerceptionPatch,
  PendingEmbedding,
  RecallHit,
  RecallItemKind,
  CharacterMemory,
  CharacterMemoryPatch,
  EventId,
  MemoryId,
  NewCharacterMemory,
  NewPerception,
  NewStoryEvent,
  NewSummary,
  PendingCommit,
  PerceivedEvent,
  Perception,
  StoryEvent,
  StoryEventFilter,
  StoryEventPatch,
  StoryThread,
  Summary,
  SummaryLevel,
  SummaryId,
  ThreadId,
  ThreadStatus,
  Character,
  CharacterControl,
  CharacterFilter,
  CharacterId,
  CharacterIntent,
  CharacterState,
  CharacterStatePatch,
  Intent,
  IntentFilter,
  IntentId,
  IntentPatch,
  JsonValue,
  NewCharacter,
  NewCharacterState,
  SessionMetadata,
  WorldReference,
} from 'dsh-roleplay-model'

/**
 * The repositories are the only way the rest of the code reads and writes a
 * session. They take and return canonical models, so callers never see rows or
 * SQL, and an implementation over another store can replace the SQLite one.
 * Methods are synchronous and throw the errors in `errors.ts`.
 */

export interface MetadataRepository {
  get(): SessionMetadata
  /** @throws {RangeError} when the name is blank. */
  setName(name: string): void
  setWorld(world: WorldReference): void
  /** Count one more played turn and set the time of the last play to now. */
  recordTurn(): SessionMetadata
  /**
   * Free-form entries for whatever else wants to remember something about the
   * session. Keys should be namespaced, such as `mymodule.lastExport`; the
   * session's own keys are reserved.
   */
  getValue(key: string): JsonValue | undefined
  setValue(key: string, value: JsonValue): void
  deleteValue(key: string): boolean
}

export interface CharacterRepository {
  /** @throws {ConflictError} when `sourceId` is already used by another character. */
  add(character: NewCharacter): Character
  get(id: CharacterId): Character | undefined
  getBySourceId(sourceId: string): Character | undefined
  list(filter?: CharacterFilter): Character[]
  /** Characters whose name or alias matches, ignoring case. */
  findByName(name: string): Character[]
  /** @throws {NotFoundError} */
  setControl(id: CharacterId, control: CharacterControl): Character
}

export interface CharacterStateRepository {
  /**
   * @throws {NotFoundError} when the character does not exist.
   * @throws {ConflictError} when it already has a state.
   */
  create(characterId: CharacterId, state: NewCharacterState): CharacterState
  get(characterId: CharacterId): CharacterState | undefined
  /**
   * @param options.expectedVersion - when given, the update only applies to that version of the state.
   * @throws {NotFoundError} when the character has no state.
   * @throws {ConflictError} when the state is at another version than expected.
   */
  update(characterId: CharacterId, patch: CharacterStatePatch, options?: { expectedVersion?: number }): CharacterState
}

export interface IntentRepository {
  /** @throws {NotFoundError} when the character does not exist. */
  add(characterId: CharacterId, intent: Intent): CharacterIntent
  get(id: IntentId): CharacterIntent | undefined
  list(characterId: CharacterId, filter?: IntentFilter): CharacterIntent[]
  /** @throws {NotFoundError} */
  update(id: IntentId, patch: IntentPatch): CharacterIntent
  /** Whether an intent was removed. */
  remove(id: IntentId): boolean
}

export interface EventRepository {
  /**
   * Record an event together with what each character took in of it, atomically.
   * @throws {NotFoundError} when a character does not exist.
   */
  add(event: NewStoryEvent, perceptions: readonly NewPerception[]): { event: StoryEvent; perceptions: Perception[] }
  get(id: EventId): StoryEvent | undefined
  /** In story order: by turn, round, then the order recorded. */
  list(filter?: StoryEventFilter): StoryEvent[]
  /** @throws {NotFoundError} @throws {ConflictError} when the event is sealed. */
  update(id: EventId, patch: StoryEventPatch): StoryEvent
  /** Replace what the characters took in of a draft event. @throws {NotFoundError} @throws {ConflictError} when the event is sealed. */
  setPerceptions(id: EventId, perceptions: readonly NewPerception[]): Perception[]
  /** Make events final: they can no longer be changed or removed. Without ids, every draft event is sealed. Returns how many were sealed. */
  seal(ids?: readonly EventId[]): number
  perceptionsOf(id: EventId): Perception[]
  getPerception(id: PerceptionId): Perception | undefined
  /**
   * Add what one more character took in of an event, also a sealed one (it learns of it later). A
   * character has one perception of an event.
   * @throws {NotFoundError} when the event or the character does not exist.
   * @throws {ConflictError} when the character already has a perception of the event: revise that one.
   */
  addPerception(id: EventId, perception: NewPerception): Perception
  /** Revise a perception, of a sealed event too. @throws {NotFoundError} */
  updatePerception(id: PerceptionId, patch: PerceptionPatch): Perception
  /** What one character took in, with the events, in story order. */
  perceivedBy(characterId: CharacterId, filter?: { fromTurn?: number; toTurn?: number }): PerceivedEvent[]
  /** Count a perception as recalled in `turn`. */
  touchPerceptions(ids: readonly number[], turn: number): void
  /** Whether a draft event was removed, with its perceptions. @throws {ConflictError} when the event is sealed. */
  remove(id: EventId): boolean
}

export interface MemoryRepository {
  /** @throws {NotFoundError} when the character does not exist. */
  add(memory: NewCharacterMemory): CharacterMemory
  get(id: MemoryId): CharacterMemory | undefined
  list(characterId: CharacterId): CharacterMemory[]
  /** @throws {NotFoundError} */
  update(id: MemoryId, patch: CharacterMemoryPatch): CharacterMemory
  /** Count a memory as recalled in `turn`. */
  touch(ids: readonly MemoryId[], turn: number): void
  remove(id: MemoryId): boolean
}

export interface ThreadRepository {
  open(text: string, turn: number): StoryThread
  get(id: ThreadId): StoryThread | undefined
  list(status?: ThreadStatus): StoryThread[]
  /** @throws {NotFoundError} */
  resolve(id: ThreadId, turn: number): StoryThread
  /** Whether a thread was removed. */
  remove(id: ThreadId): boolean
}

export interface SummaryRepository {
  add(summary: NewSummary): Summary
  /** Oldest first. */
  list(level?: SummaryLevel): Summary[]
  remove(ids: readonly SummaryId[]): void
}

export interface PendingCommitRepository {
  /** Replaces what is stored for the same round. */
  enqueue(turn: number, round: number, payload: PendingCommit['payload']): void
  /** In story order. */
  list(): PendingCommit[]
  complete(rounds: readonly { turn: number; round: number }[]): void
}

/** Whether vector search works in this session, and why not when it does not. */
export interface VectorSupport {
  available: boolean
  error?: string
}

export interface RecallSearch {
  /** What to look for: matched by its words. */
  text: string
  /** Only what this character took in or believes. Events belong to no character, so leave it out to search them. */
  characterId?: number
  kinds?: readonly RecallItemKind[]
  limit: number
}

export interface VectorSearch {
  /** The vector of what to look for, from the same model as the stored ones. */
  vector: readonly number[]
  characterId?: number
  limit: number
}

/**
 * What a session can be searched by: its texts, indexed by words and, once vectors are stored,
 * by meaning. The repositories keep the index of their own texts up to date; vectors come from
 * whoever has an embedding model.
 */
export interface RecallIndexRepository {
  readonly vectors: VectorSupport
  /** Matches by words, best first; each score is relative to the best hit. */
  lexical(search: RecallSearch): RecallHit[]
  /** Nearest by meaning, best first; each score is the cosine similarity. Empty when no vectors are stored or support is missing. */
  vector(search: VectorSearch): RecallHit[]
  /** What the stored vectors are made by, or `undefined` while there are none. */
  info(): EmbeddingIndexInfo | undefined
  /** Texts without a vector, oldest first. */
  pending(limit: number): PendingEmbedding[]
  /**
   * Store vectors for texts, by the ids `pending` gave. The first call fixes the model and the number of
   * dimensions of the session's vectors.
   * @throws {ConflictError} when the model or dimensions differ from the stored ones, or vector search is not available.
   * @throws {InvalidValueError} when the vectors differ in size.
   * @returns how many were stored.
   */
  store(model: string, vectors: readonly { id: number; vector: readonly number[] }[]): number
  /** Forget every vector (the texts stay), to start again with another model. */
  reset(): void
}

export interface LocationRepository {
  /**
   * @throws {NotFoundError} when the parent does not exist.
   * @throws {ConflictError} when the id in the world's files or a feature key is used twice.
   * @throws {InvalidValueError} when the name or the features are not acceptable.
   */
  add(location: NewLocation): Location
  get(id: LocationId): Location | undefined
  getBySourceId(sourceId: string): Location | undefined
  list(): Location[]
  childrenOf(id: LocationId): Location[]
  /** @throws {NotFoundError} @throws {ConflictError} when a feature that someone is at would go. */
  update(id: LocationId, patch: LocationPatch): Location
  /** @throws {NotFoundError} when a place does not exist. @throws {ConflictError} when there already is an exit between them in that direction. */
  addExit(exit: NewExit): Exit
  getExit(fromId: LocationId, toId: LocationId): Exit | undefined
  exitsFrom(id: LocationId): Exit[]
  allExits(): Exit[]
  /** @throws {NotFoundError} */
  updateExit(id: ExitId, patch: ExitPatch): Exit
  removeExit(id: ExitId): boolean
}

/** Where things stand. Characters now; the same table places items and containers later. */
export interface PlacementRepository {
  /**
   * Put something in a place, replacing where it was.
   * @throws {NotFoundError} when the place or the thing does not exist.
   * @throws {InvalidValueError} when the place has no such feature.
   */
  place(kind: PlaceableKind, entityId: number, placement: NewPlacement): Placement
  get(kind: PlaceableKind, entityId: number): Placement | undefined
  /** Everything in a place, in a stable order. */
  at(locationId: LocationId, kind?: PlaceableKind): Placement[]
  list(kind?: PlaceableKind): Placement[]
}
