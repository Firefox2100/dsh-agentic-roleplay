/** The key under which a session keeps the rules of its world, which it copies at the start so that it stays whole without the world's files. */
export const WORLD_RULES_KEY = 'rules'

/** The longest text of the player's own rules. */
export const MAX_OWN_RULES = 2000

/** What is not allowed in the story: the world's rules, then the player's own, one per line, blank lines left out. */
export function rulesOf(world: readonly string[], own: string): string[] {
  return [...world, ...own.split('\n').map(line => line.trim()).filter(line => line !== '')]
}
