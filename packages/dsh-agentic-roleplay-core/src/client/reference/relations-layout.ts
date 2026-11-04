export interface RelationNode { key: string; x: number; y: number }
export interface RelationsLayout { nodes: RelationNode[]; width: number; height: number; centre: { x: number; y: number } }

export const RELATION_NODE_WIDTH = 120
export const RELATION_NODE_HEIGHT = 26
const RING = 210
const MARGIN = 16

/** The people the player's character has met on a ring around the character, nearest the top first in the order given; the ring widens when many are met. */
export function layoutRelations(keys: readonly string[]): RelationsLayout {
  const radius = Math.max(RING, Math.ceil((keys.length * (RELATION_NODE_WIDTH + 12)) / (2 * Math.PI)))
  const centre = { x: MARGIN + radius + RELATION_NODE_WIDTH / 2, y: MARGIN + radius + RELATION_NODE_HEIGHT / 2 }
  const nodes = keys.map((key, index): RelationNode => {
    const angle = -Math.PI / 2 + (2 * Math.PI * index) / Math.max(1, keys.length)
    return { key, x: Math.round(centre.x + radius * Math.cos(angle)), y: Math.round(centre.y + radius * Math.sin(angle)) }
  })
  return { nodes, centre, width: Math.round(centre.x * 2), height: Math.round(centre.y * 2) }
}
