/** The longest text of the player's pinned facts. */
export const MAX_OWN_PINS = 3000

/** A line that starts with this is a soft pin: told to the game master and the record keeper like any pin, but never held against the player's actions. */
export const SOFT_PIN = '~'

export interface Pin { text: string; soft: boolean }

/** What the player has fixed in the story, one fact per line, blank lines left out. */
export const parsePins = (own: string): Pin[] => own.split('\n').map(line => line.trim()).filter(line => line !== '').map(line => line.startsWith(SOFT_PIN) ? { text: line.slice(SOFT_PIN.length).trim(), soft: true } : { text: line, soft: false }).filter(pin => pin.text !== '')

export const pinsOf = (own: string): string[] => parsePins(own).map(pin => pin.text)

/** The pins that are held against the player's actions: every one that is not soft. */
export const ruledPinsOf = (own: string): string[] => parsePins(own).filter(pin => !pin.soft).map(pin => pin.text)
