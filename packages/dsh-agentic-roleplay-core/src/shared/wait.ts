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
const isDigit = (char: string): boolean => char >= '0' && char <= '9'
const isSpace = (char: string): boolean => char.trim() === ''
const LETTER = /^\p{L}$/u
const isLetter = (char: string): boolean => LETTER.test(char)

/**
 * The wait in what a player typed after `/wait` (`2 hours`, `30m until the ferry`, `3天`). The time may be missing or unreadable, and is then `undefined` in `minutes`.
 * Read by scanning rather than by one regular expression, so that a long line of digits cannot make the matcher backtrack over itself.
 */
export function waitArguments(rawInput: string): { minutes: number | undefined; reason: string } {
  const body = rawInput.trim()
  let at = 0
  while (at < body.length && isDigit(body[at]!)) at += 1
  if (at === 0) return { minutes: undefined, reason: body }
  let whole = body.slice(0, at)
  if (body[at] === '.') {
    let fraction = at + 1
    while (fraction < body.length && isDigit(body[fraction]!)) fraction += 1
    if (fraction > at + 1) { whole = body.slice(0, fraction); at = fraction }
  }
  while (at < body.length && isSpace(body[at]!)) at += 1
  const unitStart = at
  while (at < body.length && isLetter(body[at]!)) at += 1
  if (at === unitStart) return { minutes: undefined, reason: body }
  const unit = UNITS.find(([pattern]) => pattern.test(body.slice(unitStart, at)))
  if (unit === undefined) return { minutes: undefined, reason: body }
  const minutes = Math.round(Number(whole) * unit[1])
  return { minutes: minutes >= 1 && minutes <= MAX_WAIT_MINUTES ? minutes : undefined, reason: body.slice(at).trim() }
}
