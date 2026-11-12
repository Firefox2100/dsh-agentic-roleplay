const UNITS: readonly [RegExp, number][] = [
  [/^(?:m|min|mins|minute|minutes|分钟|分)$/iu, 1],
  [/^(?:h|hr|hrs|hour|hours|小时|時間|时)$/iu, 60],
  [/^(?:d|day|days|天|日)$/iu, 1440],
]

/** The longest wait one command may ask for, whatever the chat allows: a year. */
export const MAX_WAIT_MINUTES = 365 * 1440

/**
 * The wait in what a player typed after `/wait` (`2 hours`, `30m until the ferry`, `3天`). The time may be missing or unreadable, and is then `undefined` in `minutes`.
 */
export function waitArguments(rawInput: string): { minutes: number | undefined; reason: string } {
  const body = rawInput.trim()
  const match = /^(\d+(?:\.\d+)?)\s*([\p{L}]+)\s*(.*)$/su.exec(body)
  if (match === null) return { minutes: undefined, reason: body }
  const unit = UNITS.find(([pattern]) => pattern.test(match[2]!))
  if (unit === undefined) return { minutes: undefined, reason: body }
  const minutes = Math.round(Number(match[1]) * unit[1])
  return { minutes: minutes >= 1 && minutes <= MAX_WAIT_MINUTES ? minutes : undefined, reason: match[3]!.trim() }
}
