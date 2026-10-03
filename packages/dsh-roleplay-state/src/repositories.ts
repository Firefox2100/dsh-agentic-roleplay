import type {
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
  /** @throws {NotFoundError} */
  update(id: EventId, patch: StoryEventPatch): StoryEvent
  /** Replace what the characters took in of an event. @throws {NotFoundError} */
  setPerceptions(id: EventId, perceptions: readonly NewPerception[]): Perception[]
  perceptionsOf(id: EventId): Perception[]
  /** What one character took in, with the events, in story order. */
  perceivedBy(characterId: CharacterId, filter?: { fromTurn?: number; toTurn?: number }): PerceivedEvent[]
  /** Count a perception as recalled in `turn`. */
  touchPerceptions(ids: readonly number[], turn: number): void
  /** Whether an event was removed, with its perceptions. */
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
