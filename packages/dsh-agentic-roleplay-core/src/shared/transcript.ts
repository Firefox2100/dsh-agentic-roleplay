import type { NarrationSegment, TurnOutput } from './narration.ts'
import { childrenOf, pathTo, type Timeline, type TimelineNode } from './timeline.ts'

export interface TranscriptOptions {
  title: string
  opening?: readonly NarrationSegment[]
  /** `path`: the turns from the first to the head. `all`: also every turn that was set aside, as alternatives. */
  scope: 'path' | 'all'
  /** Adds turn headings, rulings, rolls, checkpoints and which turns the story left. */
  annotated: boolean
}

const segmentLine = (segment: NarrationSegment): string => (segment.type === 'utterance' ? `**${segment.name}:** “${segment.text}”` : segment.text)

function outputLines(output: TurnOutput | undefined, annotated: boolean): string[] {
  if (output === undefined) return ['*(nothing was delivered)*']
  const lines = output.segments.map(segmentLine)
  if (!annotated) return lines
  const ruling = output.ooc
  if (ruling !== undefined) lines.push(`> ${ruling.question === true ? 'Answered out of character' : ruling.legal ? 'Ruled legal' : 'Ruled illegal and refused'}: ${ruling.note}`)
  for (const roll of output.rolls ?? []) lines.push(`> Roll (${roll.by}): ${roll.text}`)
  return lines
}

function turnBlock(node: TimelineNode, options: TranscriptOptions, extra: string): string {
  const heading = options.annotated || options.scope === 'all' ? [`### Turn ${node.turn}${node.label === undefined ? '' : ` — checkpoint “${node.label}”`}${extra}`, ...(node.note === undefined ? [] : [`> Note: ${node.note}`])] : []
  return [...heading, `*${node.player.trim()}*`, ...outputLines(node.output, options.annotated)].join('\n\n')
}

/** The story as Markdown: the opening, then each turn as the player's words in italics followed by what was told. With every turn (`all`) each one has a heading, so the alternatives can be told apart. */
export function transcriptMarkdown(timeline: Timeline, options: TranscriptOptions): string {
  const parts = [`# ${options.title}`]
  if (options.opening !== undefined) parts.push(options.opening.map(segmentLine).join('\n\n'))
  const onPath = new Set(pathTo(timeline, timeline.head).map(node => node.id))
  if (options.scope === 'path') {
    for (const node of pathTo(timeline, timeline.head)) parts.push(turnBlock(node, options, ''))
    return `${parts.join('\n\n')}\n`
  }
  const walk = (parent: string | null): void => {
    const siblings = childrenOf(timeline, parent).sort((a, b) => Number(onPath.has(b.id)) - Number(onPath.has(a.id)))
    siblings.forEach((node, index) => {
      const taken = onPath.has(node.id)
      const marker = siblings.length > 1 ? ` — alternative ${index + 1} of ${siblings.length}${taken ? ' (the story went this way)' : ' (set aside)'}` : taken ? '' : ' (set aside)'
      const block = turnBlock(node, options, marker)
      parts.push(block)
      walk(node.id)
    })
  }
  walk(null)
  return `${parts.join('\n\n')}\n`
}

/** The same story as data: every turn with its parent, so a branch can be rebuilt by a reader. */
export function transcriptJson(timeline: Timeline, options: TranscriptOptions): Record<string, unknown> {
  const keep = options.scope === 'path' ? pathTo(timeline, timeline.head) : timeline.nodes
  return {
    version: 1,
    title: options.title,
    ...(options.opening === undefined ? {} : { opening: options.opening }),
    head: timeline.head,
    turns: keep.map(node => ({
      id: node.id, parent: node.parent, turn: node.turn, createdAt: node.createdAt, player: node.player,
      ...(node.output === undefined ? {} : { output: options.annotated ? node.output : { segments: node.output.segments } }),
      ...(options.annotated && node.label !== undefined ? { checkpoint: { label: node.label, ...(node.note === undefined ? {} : { note: node.note }) } } : {}),
    })),
  }
}
