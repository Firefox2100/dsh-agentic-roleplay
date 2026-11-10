/** The dream a player asks to enter (`/dream`, `/dream Clara`, `/dream 做梦的人`), or nothing when the message does not start with `/dream`. `who` is empty when no one is named. */
export function parseDream(text: string): { who: string } | undefined {
  const value = text.trimStart()
  if (value.slice(0, 6).toLowerCase() !== '/dream' || (value.length > 6 && !/\s/u.test(value[6]!))) return undefined
  return { who: value.slice(6).trim() }
}
