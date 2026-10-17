/** The player rolls dice before acting: `/roll 2d6+1 pick the lock`. The dice are then part of what the game master judges. */
const ROLL_COMMAND = /^\s*\/roll(?=\s|$)\s*(\S*)\s*([\s\S]*)$/i

/** The roll in a player's message, or nothing when the message does not start with `/roll`. The notation may be empty, and is then refused. */
export function parseRoll(text: string): { expression: string; reason: string } | undefined {
  const match = ROLL_COMMAND.exec(text)
  return match === null ? undefined : { expression: match[1] ?? '', reason: (match[2] ?? '').trim() }
}
