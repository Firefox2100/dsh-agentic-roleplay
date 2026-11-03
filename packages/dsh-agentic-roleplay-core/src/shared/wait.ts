const UNITS: readonly [RegExp, number][] = [
  [/^(?:m|min|mins|minute|minutes|分钟|分)$/iu, 1],
  [/^(?:h|hr|hrs|hour|hours|小时|時間|时)$/iu, 60],
  [/^(?:d|day|days|天|日)$/iu, 1440],
]

/** The longest wait one command may ask for, whatever the chat allows: a year. */
export const MAX_WAIT_MINUTES = 365 * 1440

/**
 * The wait in a player's message (`/wait 2 hours`, `/wait 30m until the ferry`, `/wait 3天`), or nothing when the message does not start with `/wait`. The time may be missing or
 * unreadable, and is then `undefined` in `minutes`.
 */
export function parseWait(text: string): { minutes: number | undefined; reason: string } | undefined {
  const value = text.trimStart()
  if (value.slice(0, 5).toLowerCase() !== '/wait' || (value.length > 5 && !/\s/u.test(value[5]!))) return undefined
  const body = value.slice(5).trim()
  const match = /^(\d+(?:\.\d+)?)\s*([\p{L}]+)\s*(.*)$/su.exec(body)
  if (match === null) return { minutes: undefined, reason: body }
  const unit = UNITS.find(([pattern]) => pattern.test(match[2]!))
  if (unit === undefined) return { minutes: undefined, reason: body }
  const minutes = Math.round(Number(match[1]) * unit[1])
  return { minutes: minutes >= 1 && minutes <= MAX_WAIT_MINUTES ? minutes : undefined, reason: match[3]!.trim() }
}
