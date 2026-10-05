import type {
  NewTriggerNote, Trigger, TriggerDefinition, TriggerId, TriggerNote, TriggerNoteKind, TriggerStatus,
  StoredVariable, VariableDefinition, VariableDefinitionInput, VariableSubject, VariableValue,
  Engagement, EngagementFilter, EngagementId, EngagementPatch, NewEngagement, RoutineWindow, StoredRoutineWindow,
  ClockMode, ClockState, TimeChange, TimeChangeFilter, TimeChangeKind,
  Holder, Holding, Item, ItemId, ItemPatch, NewItem, Slot,
  ConsolidationItem,
  ConsolidationItemId,
  ConsolidationKind,
  EmbeddingIndexInfo,
  Relationship,
  RelationshipPatch,
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

/** How each character stands towards each other character: one profile per direction. */
export interface RelationshipRepository {
  /**
   * Create the profile, or change what is given of an existing one.
   * @throws {NotFoundError} when a character does not exist.
   * @throws {InvalidValueError} for a new profile without a label, towards itself, or with a value out of range.
   */
  upsert(fromId: CharacterId, toId: CharacterId, patch: RelationshipPatch, turn: number): Relationship
  get(fromId: CharacterId, toId: CharacterId): Relationship | undefined
  /** How a character sees others. */
  from(characterId: CharacterId): Relationship[]
  /** How others see a character. */
  to(characterId: CharacterId): Relationship[]
  list(): Relationship[]
  remove(fromId: CharacterId, toId: CharacterId): boolean
}

/** What was made up in play and still has to be fitted into the rest of the world. */
export interface ConsolidationRepository {
  enqueue(item: { kind: ConsolidationKind; subjectId: number; note: string; turn: number }): ConsolidationItem
  get(id: ConsolidationItemId): ConsolidationItem | undefined
  /** Not yet resolved, oldest first. */
  pending(): ConsolidationItem[]
  /** Everything made up in a turn, resolved or not. */
  createdIn(turn: number): ConsolidationItem[]
  /** Mark it fitted in, with what was done. Resolving a resolved item changes nothing. @throws {NotFoundError} */
  resolve(id: ConsolidationItemId, turn: number, resolution: string): ConsolidationItem
}

/** The places on the body something can be worn, and how many things fit in each. */
export interface SlotRepository {
  /** Add the slots a world starts with, leaving any that exist. */
  ensureDefaults(): void
  list(): Slot[]
  get(id: string): Slot | undefined
  /** Make or change a slot. @throws {ConflictError} when it would hold fewer than are worn in it. */
  upsert(slot: Slot): Slot
}

/** Things that can be moved, held, worn, opened or used, and where each is. */
export interface ItemRepository {
  /**
   * Make an item and put it where it starts, together.
   * @throws {InvalidValueError} for a bad name, quantity, state, or a holder that cannot hold it.
   * @throws {ConflictError} when its id in the world's files is used, or the slot is full.
   */
  add(item: NewItem, holder: Holder): Item
  get(id: ItemId): Item | undefined
  getBySourceId(sourceId: string): Item | undefined
  list(): Item[]
  /** @throws {NotFoundError} */
  update(id: ItemId, patch: ItemPatch): Item
  /** Whether an item was removed (used up, destroyed). @throws {ConflictError} when it still holds things. */
  remove(id: ItemId): boolean
  holding(id: ItemId): Holding | undefined
  /**
   * Put an item somewhere else, replacing where it was.
   * @throws {InvalidValueError} when the holder cannot hold it: a place without that feature, something worn that cannot be worn there, a thing that is not a container, an item inside itself.
   * @throws {ConflictError} when the slot is full.
   */
  place(id: ItemId, holder: Holder): Holding
  /** What a place, a character or an item holds directly. */
  contents(holder: { kind: 'location' | 'character' | 'item'; id: number }): { item: Item; holding: Holding }[]
  /** The containers an item is inside, innermost first. */
  ancestors(id: ItemId): ItemId[]
  /** The place an item is in, following what holds it, and the character that has it when one does. */
  where(id: ItemId): { locationId?: number; characterId?: number }
  /** The items that open an item that is a container, or an exit. */
  openers(target: { kind: 'item' | 'exit'; id: number }): ItemId[]
  setOpeners(target: { kind: 'item' | 'exit'; id: number }, items: readonly ItemId[]): void
}

/** The story's own time: what instant it is in the story, and how it got there. */
export interface ClockRepository {
  /** The clock, or nothing before it was started. */
  get(): ClockState | undefined
  /** Start the clock. @throws {ConflictError} when it is started. */
  start(mode: ClockMode, now: number): ClockState
  /**
   * Move the story's time forward, and keep why.
   * @throws {NotFoundError} when the clock is not started.
   * @throws {InvalidValueError} when the instant is not after the current one.
   */
  advance(step: { to: number; turn: number; round: number; kind: Exclude<TimeChangeKind, 'start' | 'resync'>; reason?: string }): TimeChange
  /** Set the clock to an instant in either direction and to a mode, as when it is changed from following the wall clock to being the story's own. @throws {NotFoundError} */
  resync(mode: ClockMode, now: number, turn: number, reason?: string): TimeChange
  log(filter?: TimeChangeFilter): TimeChange[]
  /** The instant a round began, when it is known: where an event of that round is placed in time. */
  at(turn: number, round: number): number | undefined
}

/** The recurring days of the characters: windows of the day with what they are doing and where. */
export interface RoutineRepository {
  /** The windows of a character, in the order they were given: the first that fits the moment is the one that applies. */
  list(characterId: CharacterId): StoredRoutineWindow[]
  /** Every window of every character. */
  all(): StoredRoutineWindow[]
  /**
   * Replace a character's windows.
   * @throws {InvalidValueError} for a window that is empty, has a minute that is not one, a day that is not one, or a place or character that does not exist.
   */
  replace(characterId: CharacterId, windows: readonly RoutineWindow[]): StoredRoutineWindow[]
}

/** Dated commitments: what characters are due to do, and whether they did. */
export interface EngagementRepository {
  /** @throws {InvalidValueError} for an empty title, an end before the start, no participants, or a place or character that does not exist. */
  add(engagement: NewEngagement): Engagement
  get(id: EngagementId): Engagement | undefined
  /** In order of when they are due. */
  list(filter?: EngagementFilter): Engagement[]
  /** @throws {NotFoundError} */
  update(id: EngagementId, patch: EngagementPatch): Engagement
  remove(id: EngagementId): boolean
}

/** What the story keeps track of: the kinds of variable there are, and the value each subject has. */
export interface VariableRepository {
  /** Add the variables every story has (the feelings of characters), leaving any that exist. */
  ensureDefaults(): void
  /** In the order they were declared. */
  defs(): VariableDefinition[]
  def(key: string): VariableDefinition | undefined
  /**
   * Declare a variable, or change one (what is not given takes its default; a built-in one keeps what it is).
   * @throws {InvalidValueError} for a key, kind, bounds, options, default or words that are not acceptable, or when the story has too many.
   */
  define(input: VariableDefinitionInput): VariableDefinition
  /** Remove a variable and every value of it. @throws {ConflictError} for a built-in one. */
  remove(key: string): boolean
  /** What one subject has stored for a variable, if anything. */
  get(variable: string, subject: VariableSubject, subjectId: number): StoredVariable | undefined
  /** What it is for the subject: its own value, or the default. */
  value(variable: string, subject: VariableSubject, subjectId: number): VariableValue
  /**
   * Set a subject's value (and, for a variable with a baseline, its baseline). The first value of a variable with a baseline sets the baseline too, unless one is given.
   * @throws {NotFoundError} for a variable that is not declared.
   * @throws {InvalidValueError} for a subject it does not apply to, or a value it cannot have.
   */
  set(variable: string, subject: VariableSubject, subjectId: number, change: { value?: VariableValue; baseline?: VariableValue }, turn: number): StoredVariable
  /** Everything stored for one subject. */
  list(subject: VariableSubject, subjectId: number): StoredVariable[]
  /** Everything stored for anything, most recently changed first. */
  all(): StoredVariable[]
  /** Whether a variable applies to a subject. */
  applies(def: VariableDefinition, subject: VariableSubject, subjectId: number): boolean
}

/** What a world, or a story, makes happen when its conditions come true, and what that leaves to be told. */
export interface TriggerRepository {
  /** @throws {ConflictError} for a key that exists. @throws {InvalidValueError} for a definition that is not acceptable, or when the story has too many. */
  add(definition: TriggerDefinition, origin: Trigger['origin'], turn: number): Trigger
  get(id: TriggerId): Trigger | undefined
  getByKey(key: string): Trigger | undefined
  /** By priority, highest first, then in the order made. */
  list(filter?: { status?: TriggerStatus }): Trigger[]
  /** @throws {NotFoundError} */
  update(id: TriggerId, patch: { status?: TriggerStatus; fireCount?: number; lastFiredMs?: number; lastResult?: boolean; problem?: string }): Trigger
  addNote(note: NewTriggerNote): TriggerNote
  /** Oldest first. */
  notes(filter?: { status?: TriggerNote['status']; kind?: TriggerNoteKind }): TriggerNote[]
  /** @throws {NotFoundError} */
  resolveNote(id: number, status: 'done' | 'lapsed'): void
}
