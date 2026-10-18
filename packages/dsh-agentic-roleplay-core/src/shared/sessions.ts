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
  /** The other openings the player may start with, in order (the request names one by its place here); the world's own opening is always the first choice. An opening with a character is for that character only. */
  openings: readonly { title: string; character?: string }[]
  /** When the world's story begins, as local time in its zone (`2024-05-01T08:00:00`), or empty when it has no starting time. */
  startingTime: string
  /** The zone that time is in; empty when the world names none. */
  timeZone: string
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
  /** Starts with this alternate opening of the world (its position in the list) instead of the world's own. */
  opening?: number
  /** Starts the story at this local time (`2024-05-01T08:00:00`, in the story's zone) instead of the world's starting time; refused when the chat's time follows the wall clock. */
  startingTime?: string
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
