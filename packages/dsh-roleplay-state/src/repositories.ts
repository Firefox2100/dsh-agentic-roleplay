import type {
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
  /** `null` removes the title. */
  setTitle(title: string | null): void
  setWorld(world: WorldReference): void
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
