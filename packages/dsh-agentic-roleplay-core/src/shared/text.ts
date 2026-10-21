/** Remove characters from either end without a backtracking regular expression. */
export function trimCharacters(value: string, characters: string, edge: 'start' | 'end' | 'both' = 'both'): string {
  let start = 0
  let end = value.length
  if (edge !== 'end') while (start < end && characters.includes(value[start]!)) start += 1
  if (edge !== 'start') while (end > start && characters.includes(value[end - 1]!)) end -= 1
  return value.slice(start, end)
}

/** A path-like name without its last extension. */
export function withoutExtension(value: string): string {
  const dot = value.lastIndexOf('.')
  return dot < 0 ? value : value.slice(0, dot)
}
