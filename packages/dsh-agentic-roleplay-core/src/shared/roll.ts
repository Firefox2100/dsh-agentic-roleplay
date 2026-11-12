/** The dice and the reason in what a player typed after `/roll`. The notation may be empty, and is then refused. */
export function rollArguments(rawInput: string): { expression: string; reason: string } {
  const body = rawInput.trimStart()
  const boundary = body.search(/\s/u)
  return boundary < 0 ? { expression: body, reason: '' } : { expression: body.slice(0, boundary), reason: body.slice(boundary).trim() }
}
