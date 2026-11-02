export interface MapPlace { key: string; here: boolean }
export interface MapRoute { from: string; to: string; open: boolean }
export interface PlacedNode { key: string; x: number; y: number }
export interface MapLayout { nodes: PlacedNode[]; links: { from: string; to: string; open: boolean }[]; width: number; height: number }

export const NODE_WIDTH = 160
export const NODE_HEIGHT = 28
const GAP_X = 40
const GAP_Y = 14
const PAD = 8

/**
 * Places in columns by how many ways they are from where the player is, so the map reads outward from the player's place.
 * Ways count in both directions; places no known way reaches are set in the columns after the last reachable one.
 */
export function layoutMap(places: readonly MapPlace[], routes: readonly MapRoute[]): MapLayout {
  const keys = new Set(places.map(place => place.key))
  const links = new Map<string, { from: string; to: string; open: boolean }>()
  for (const route of routes) {
    if (!keys.has(route.from) || !keys.has(route.to) || route.from === route.to) continue
    const id = [route.from, route.to].sort().join('\n')
    const known = links.get(id)
    links.set(id, { from: route.from, to: route.to, open: route.open || known?.open === true })
  }
  const next = new Map<string, string[]>(places.map(place => [place.key, []]))
  for (const link of links.values()) { next.get(link.from)?.push(link.to); next.get(link.to)?.push(link.from) }
  const depth = new Map<string, number>()
  const walk = (start: string, from: number): void => {
    depth.set(start, from)
    for (let queue = [start]; queue.length > 0;) {
      const following: string[] = []
      for (const key of queue) for (const other of next.get(key) ?? []) if (!depth.has(other)) { depth.set(other, (depth.get(key) ?? 0) + 1); following.push(other) }
      queue = following
    }
  }
  const origin = places.find(place => place.here) ?? places[0]
  if (origin !== undefined) walk(origin.key, 0)
  for (const place of places) if (!depth.has(place.key)) walk(place.key, Math.max(-1, ...depth.values()) + 1)
  const rows = new Map<number, number>()
  const nodes = places.map((place): PlacedNode => {
    const column = depth.get(place.key) ?? 0
    const row = rows.get(column) ?? 0
    rows.set(column, row + 1)
    return { key: place.key, x: PAD + column * (NODE_WIDTH + GAP_X), y: PAD + row * (NODE_HEIGHT + GAP_Y) }
  })
  return {
    nodes,
    links: [...links.values()],
    width: PAD * 2 + (Math.max(0, ...depth.values()) + 1) * NODE_WIDTH + Math.max(0, ...depth.values()) * GAP_X,
    height: PAD * 2 + Math.max(1, ...rows.values()) * NODE_HEIGHT + (Math.max(1, ...rows.values()) - 1) * GAP_Y,
  }
}

const LABEL_UNITS = 22

/** A place's name cut to fit its box; a character of CJK script is as wide as two of any other. */
export function fitLabel(name: string): string {
  let used = 0
  let out = ''
  for (const character of name) {
    used += /[\u2e80-\u9fff\uff00-\uffef]/.test(character) ? 2 : 1
    if (used > LABEL_UNITS) return `${out.trimEnd()}…`
    out += character
  }
  return out
}
