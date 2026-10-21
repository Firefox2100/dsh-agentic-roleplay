/** The roll in a player's message, or nothing when the message does not start with `/roll`. The notation may be empty, and is then refused. */
export function parseRoll(text: string): { expression: string; reason: string } | undefined {
  const value = text.trimStart()
  if (value.slice(0, 5).toLowerCase() !== '/roll' || (value.length > 5 && !/\s/u.test(value[5]!))) return undefined
  const body = value.slice(5).trimStart()
  const boundary = body.search(/\s/u)
  return boundary < 0 ? { expression: body, reason: '' } : { expression: body.slice(0, boundary), reason: body.slice(boundary).trim() }
}
