import { readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { emptyTimeline, type Timeline, type TimelineNode } from '../../shared/timeline.ts'

export const TIMELINE_FILE = 'timeline.json'

function isNode(value: unknown): value is TimelineNode {
  if (typeof value !== 'object' || value === null) return false
  const node = value as Record<string, unknown>
  return typeof node['id'] === 'string' && (node['parent'] === null || typeof node['parent'] === 'string') && typeof node['turn'] === 'number'
    && typeof node['userSeq'] === 'number' && typeof node['player'] === 'string' && typeof node['createdAt'] === 'string'
}

/**
 * The timeline of a session, or an empty one when it has none yet.
 * @throws {Error} when the file is there and is not a timeline: it holds what lets the story be taken back, so it is not replaced silently.
 */
export function readTimeline(folder: string): Timeline {
  let text: string
  try {
    text = readFileSync(join(folder, TIMELINE_FILE), 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return emptyTimeline()
    throw error
  }
  const value = JSON.parse(text) as Partial<Timeline>
  if (value.version !== 1 || !Array.isArray(value.nodes) || !value.nodes.every(isNode) || typeof value.next !== 'number' || (value.head !== null && typeof value.head !== 'string')) {
    throw new Error(`${join(folder, TIMELINE_FILE)} is not a timeline`)
  }
  return value as Timeline
}

/** Writes it aside and renames it, so a crash leaves the timeline as it was. */
export function writeTimeline(folder: string, timeline: Timeline): void {
  const target = join(folder, TIMELINE_FILE)
  const aside = `${target}.writing`
  writeFileSync(aside, JSON.stringify(timeline, null, 2))
  renameSync(aside, target)
}
