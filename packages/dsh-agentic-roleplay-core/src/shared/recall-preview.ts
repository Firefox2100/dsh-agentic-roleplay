import type { RunRecall } from './activity.ts'

/** What an author asks: how a moment would reach the characters, without playing it. */
export interface RecallPreviewRequest {
  /** The moment, as the game master would describe it to a character. */
  situation: string
  /** One character's key; without it, the characters at the player's place. */
  character?: string
}

/** What one character would be reminded of and given to know for the moment. */
export interface RecallPreviewCharacter {
  key: string
  name: string
  /** Where it stands; absent when it is nowhere. */
  place?: string
  /** What its memory brings back, with the reasons, as a turn would: the same recall, counted as nothing. */
  memories: RunRecall[]
  /** The titles of the background it may look up, which a character reads only when it asks. */
  lore: string[]
  /** How many places, things, people, organisations and routes it knows of. */
  known: { characters: number; factions: number; places: number; things: number; routes: number }
}

export interface RecallPreview {
  /** The turn the next message would be. */
  turn: number
  situation: string
  /** Whether the moment's meaning (and not only its words) was used, which needs stored vectors and an embedding service. */
  byMeaning: boolean
  /** The most things a character is reminded of (the story's memory setting). */
  limit: number
  characters: RecallPreviewCharacter[]
}

/** The longest situation accepted. */
export const MAX_SITUATION = 4000
