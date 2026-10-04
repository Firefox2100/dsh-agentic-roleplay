export * from 'dsh-roleplay-model'
export { systemClock, type Clock } from './clock.ts'
export { nodeSqliteDriver } from './driver/node-sqlite.ts'
export type { OpenOptions, RunResult, SqlDatabase, SqlDriver, SqlValue } from './driver/types.ts'
export {
  ConflictError,
  CorruptDataError,
  InvalidEditError,
  InvalidMoveError,
  InvalidValueError,
  NotFoundError,
  SchemaError,
  StateError,
} from './errors.ts'
export type {
  CharacterRepository, CharacterStateRepository, EventRepository, IntentRepository, MemoryRepository, MetadataRepository,
  PendingCommitRepository, ConsolidationRepository, LocationRepository, PlacementRepository, RelationshipRepository, RecallIndexRepository, RecallSearch, SummaryRepository, ThreadRepository, VectorSearch, VectorSupport,
} from './repositories.ts'
export { apply, Config, name, RoleplayState, type Session } from './plugin.ts'
export type { SemanticRanker } from './memory/ranker.ts'
export { createTools, type AgentLink, type AgentResolver } from './tools/index.ts'
export { createCharacterTools } from './tools/character.ts'
export {
  applyRecordsEdit, characterKey, locationKey, parseRecordsEdit, recordsEditSchema,
  type BeliefEdit, type CharacterMove, type EditResult, type EventEdit, type ExitChange, type NewBelief, type NewEvent, type NewExit as NewExitEdit, type NewExitBetween, type NewPlace, type NewCharacterSpec, type PlaceEdit, type RelationshipRetraction, type RelationshipSet, type PerceivedBy, type PerceptionAddition, type PerceptionEdit, type RecordsEdit, type RecordsTarget, type StatePatch,
} from './records/edit.ts'
export { moveCharacter, planMove, type MoveContext } from './records/movement.ts'
export { lintWorld, type LintFinding, type LintSeverity, type LintTarget } from './records/lint.ts'
export { readRecords, type RecordsScope, type RecordsView } from './records/read.ts'
export { clarityAt, denseScore, DEFAULT_MEMORY_POLICY, jitter, mentioned, overlap, finishRecall, fuseScores, poolCandidates, recall, recallCandidates, recallPool, retention, tokens, type Clarity, type MemoryPolicy, type RecallCandidate, type RecallEvidence, type RecallPool, type RecallQuery, type RecallSource, type Recalled } from './memory/recall.ts'
export {
  createSession,
  deleteSession,
  isSessionId,
  listSessions,
  openSession,
  SESSION_DATABASE_FILE,
  sessionDatabase,
  sessionFolder,
  type SessionInit,
  type SessionListing,
} from './sessions.ts'
export { createSessionStore, openSessionStore, SCHEMA_VERSION, type SessionStore, type StoreOptions } from './store.ts'
