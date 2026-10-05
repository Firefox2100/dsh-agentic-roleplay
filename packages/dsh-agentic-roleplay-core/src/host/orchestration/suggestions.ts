/** A suggestion is a short line the player may send as it is. */
export const MAX_SUGGESTION = 200

/** What is wrong with a set of suggestions, one problem per entry; empty when they are acceptable. */
export function suggestionProblems(lines: readonly string[], wanted: number): string[] {
  return [
    ...(lines.length === wanted ? [] : [`give exactly ${wanted} suggestion${wanted === 1 ? '' : 's'}, not ${lines.length}`]),
    ...lines.flatMap((line, index) => (line === '' ? [`suggestion ${index + 1} is empty`] : line.length > MAX_SUGGESTION ? [`suggestion ${index + 1} is longer than ${MAX_SUGGESTION} characters: keep each to a short line`] : [])),
    ...(new Set(lines.map(line => line.toLowerCase())).size === lines.length ? [] : ['the suggestions must differ from each other']),
  ]
}

/** One short line each: whitespace is collapsed. */
export const tidySuggestions = (lines: readonly string[]): string[] => lines.map(line => line.trim().replace(/\s+/g, ' '))
