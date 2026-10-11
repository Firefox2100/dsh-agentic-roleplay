import type { CharacterKind, CharacterRole, CharacterTier } from 'dsh-roleplay-model'
import type { WorldProblem } from './worlds.ts'

/** A character as the start dialog lists it. */
export interface CharacterSummary {
  /** The character's id in its world's files. */
  id: string
  name: string
  summary: string
  role: CharacterRole
  tier: CharacterTier
  kind: CharacterKind
}

export interface WorldCharactersPayload {
  characters: readonly CharacterSummary[]
  problems: readonly WorldProblem[]
}

export interface StartSessionRequest {
  worldId: string
  /** Defaults to the world's name. */
  name?: string
  /** Id of the playable character of the world the player takes; exactly one of this and `playerAvatar` is given. */
  playerCharacterId?: string
  /** Key of one of `avatars` the player takes. */
  playerAvatar?: string
  /** Keys of the player avatars brought into this session as characters; they are not added to the world. */
  avatars?: string[]
  /** The settings of the chat from its first message; what is left out takes its default. They can be changed later. */
  settings?: unknown
}

export interface StartedSession {
  id: string
  /** The DSH chat session to open. */
  chatSessionId: string
  name: string
  worldId: string
  worldName: string
  characterCount: number
}

export interface SessionSummary {
  id: string
  /** The DSH chat session this session is played in. */
  chatSessionId: string
  name: string
  worldId: string
  worldName: string
  createdAt: string
  /** Absent for a session that has not been played yet. */
  lastPlayedAt?: string
  turns: number
  /** When the session was put away; absent for one in use. */
  archivedAt?: string
}

export interface OpenedSession {
  id: string
  chatSessionId: string
}

export interface SessionsPayload {
  /** Absolute path of the folder sessions are kept in. */
  directory: string
  /** Most recently played first. */
  sessions: readonly SessionSummary[]
  problems: readonly WorldProblem[]
}
