import { parseAuthoringCommand } from './authoring-commands.ts'

/** One lorebook entry of a character card, as the importer and its preview see it. */
export interface CardEntry {
  /** `entry:<position in the book>`: stable for the card, so the player's choices can name it. */
  id: string
  title: string
  keys: string[]
  secondaryKeys: string[]
  content: string
  /** Whether the card itself had the entry switched on. */
  enabled: boolean
  constant: boolean
  selective: boolean
  position: string
}

/** A character card, with a V2 card carried over into the V3 shape. Scripts and other machinery of the tool that made it are counted, not kept. */
export interface NormalizedCard {
  /** The version the file was, before it was carried over. */
  sourceSpec: 'chara_card_v2' | 'chara_card_v3'
  name: string
  description: string
  personality: string
  scenario: string
  firstMessage: string
  alternateGreetings: string[]
  messageExample: string
  creatorNotes: string
  systemPrompt: string
  postHistoryInstructions: string
  tags: string[]
  creator: string
  characterVersion: string
  book?: { name: string; description: string; entries: CardEntry[] }
  /** Parts of the card that were left out because they are code or settings of another tool. */
  ignored: { scripts: number; extensions: string[] }
  /** Every web address found anywhere in the card, scripts included, in the order they appear. */
  urls?: string[]
}

/** Which opening the new world starts with: the card's first message, one of its alternate greetings, or none. */
export type OpeningChoice = { kind: 'first' } | { kind: 'alternate'; index: number } | { kind: 'none' }

/** What the person importing decided about the card before anything is made of it. */
export interface ImportChoices {
  /** The name the new world gets. */
  name: string
  /** The ids of the lorebook entries that are left out. */
  disabledEntries: string[]
  opening: OpeningChoice
}

/** A world of the person's that an uploaded card could update: one that was itself imported from a card. */
export interface UpdateTarget {
  worldId: string
  name: string
  /** Whether the world has the card's name, which is what makes updating it the natural thing to do; any other world is offered too, for a card that was renamed. */
  sameName: boolean
  /** Whether the world's files still are what the import left: `no` when nobody changed them, `unknown` for a world imported before the import kept a record. */
  edited: 'no' | 'yes' | 'unknown'
  /** The files that differ from what the import left, a few of them. */
  changes: string[]
}

/** What the world editor needs to know to offer a card update. */
export interface UpdateStatus {
  /** The world was made from a card whose import is over, so a newer card can update it. */
  fromCard: boolean
  /** The world was kept as it was before its last update, which can be undone. */
  revertible: boolean
  /** A newer card is waiting, because an update was started and has not been finished. */
  waiting: boolean
}

/** What the import page shows of an uploaded card. */
export interface ImportPreview {
  id: string
  card: NormalizedCard
  choices: ImportChoices
  hasAvatar: boolean
  /** The worlds this card could update instead of becoming a new one, those with its name first. */
  targets?: UpdateTarget[]
}

export const MAX_IMPORT_NAME = 200

/** The message the plugin sends on the player's behalf to start the import in the new world's authoring chat. */
export const IMPORT_COMMAND = '/import-st'

/** The command in a message, with the card it names, or nothing when the message is not the command. */
export function parseImportCommand(text: string): { card: string; request: string } | undefined {
  const command = parseAuthoringCommand(text, [IMPORT_COMMAND.slice(1)])
  if (command === undefined) return undefined
  const boundary = command.rest.search(/\s/u)
  return boundary < 0 ? { card: command.rest, request: '' } : { card: command.rest.slice(0, boundary), request: command.rest.slice(boundary).trim() }
}
