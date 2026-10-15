import { locationKey } from '@dsh-agentic-roleplay/state'
import type { Location } from 'dsh-roleplay-model'

/** Whether an action said to happen at a place is where the character is. */
export type Whereabouts =
  | { kind: 'unknown' }
  | { kind: 'unplaced' }
  | { kind: 'here' }
  | { kind: 'elsewhere'; target: Location; here: Location }

const within = (inner: Location, outer: Location, places: readonly Location[]): boolean => {
  const byId = new Map(places.map(place => [place.id, place]))
  const seen = new Set<number>()
  for (let at: Location | undefined = inner; at !== undefined && !seen.has(at.id); at = at.parentId === undefined ? undefined : byId.get(at.parentId)) {
    if (at.id === outer.id) return true
    seen.add(at.id)
  }
  return false
}

/** Whether two places are one scene: the same place, or one inside the other (a room and its building). */
export const sameScene = (a: Location, b: Location, places: readonly Location[]): boolean => within(a, b, places) || within(b, a, places)

/**
 * Compares the place an action is said to happen at (by key) with where the character is. Only a proven mismatch counts: a character that is
 * nowhere, or a world without places, is no evidence, and a place that contains the other (a room and its building) is the same for this.
 */
export function whereabouts(places: readonly Location[], here: Location | undefined, at: string): Whereabouts {
  const target = places.find(place => locationKey(place) === at)
  if (target === undefined) return { kind: 'unknown' }
  if (here === undefined) return { kind: 'unplaced' }
  return within(here, target, places) || within(target, here, places) ? { kind: 'here' } : { kind: 'elsewhere', target, here }
}
