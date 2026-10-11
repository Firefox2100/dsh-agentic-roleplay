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

/** What the import page shows of an uploaded card. */
export interface ImportPreview {
  id: string
  card: NormalizedCard
  choices: ImportChoices
  hasAvatar: boolean
}

export const MAX_IMPORT_NAME = 200

/** The message the plugin sends on the player's behalf to start the import in the new world's authoring chat. */
export const IMPORT_COMMAND = '/import-st'

/** The command in a message, with the card it names, or nothing when the message is not the command. */
export function parseImportCommand(text: string): { card: string; request: string } | undefined {
  const match = /^\s*\/import-st(?=\s|$)\s*(\S*)\s*([\s\S]*)$/i.exec(text)
  return match === null ? undefined : { card: match[1] ?? '', request: (match[2] ?? '').trim() }
}
