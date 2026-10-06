import type { ConversationNodeContext, ConversationNodeDefinition } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { OocRuling } from '../../shared/ooc.ts'
import { decodeOutput, decodePreview, type NarrationSegment } from '../../shared/narration.ts'

export const NARRATION_NODE = 'roleplay-narration'

/** What a narration node carries. */
export interface NarrationNodeData {
  segments: readonly NarrationSegment[]
  repaired: boolean
  /** For an out-of-character command: whether it was allowed and what the player is told of it. */
  ooc?: OocRuling
}

export const PREVIEW_NODE = 'roleplay-preview'

/** What a preview node carries: how the game master opened the scene before the output was ready. */
export interface PreviewNodeData {
  text: string
}

interface NarrationState {
  seq: number
  data: NarrationNodeData
}

/** The words of the text blocks of a message. */
export function textOf(content: readonly { type: string; text?: string }[]): string {
  return content.flatMap(block => (block.type === 'text' && block.text !== undefined ? [block.text] : [])).join('\n').trim()
}

/** The output of a turn, when this event is the result of the tool that delivered it. */
function outputOf(event: { type: string; data: unknown }): { id: string; output: NarrationNodeData } | undefined {
  if (event.type !== 'tool/result') return undefined
  const { message } = event.data as { message: { toolCallId: string; content: readonly { type: string; text?: string }[] } }
  const output = decodeOutput(textOf(message.content))
  return output === undefined ? undefined : { id: String(message.toolCallId), output }
}

/**
 * The output of a turn is not part of any step's process, so it is placed at the
 * session level: the Chat then shows it in the transcript instead of folding it
 * away with the tool calls.
 */
const SESSION = { kind: 'session' } as const

const narrationState = (context: ConversationNodeContext<NarrationState>): NarrationState | undefined => context.state

/** The output of a turn as a node of the Chat. */
export const chatNarration: ConversationNodeDefinition<NarrationState> = {
  kind: NARRATION_NODE,
  target: 'chat',
  match: (event) => {
    const found = outputOf(event)
    return found === undefined ? null : { id: found.id, role: 'start' }
  },
  start: (_context, match) => {
    const found = outputOf(match.event)
    if (found === undefined) throw new Error('roleplay-narration starts with the result of the tool that delivers the output')
    return { seq: match.event.seq, data: found.output }
  },
  update: context => narrationState(context) as NarrationState,
  publication: () => 'immediate',
  buildViewNode: (context) => {
    const state = narrationState(context)
    if (state === undefined) return null
    return { key: context.key, kind: NARRATION_NODE, id: context.id, target: 'chat', anchorSeq: state.seq, location: SESSION, visibility: 'visible', data: state.data }
  },
}

interface PreviewState {
  seq: number
  data: PreviewNodeData
}

/** The preview of a turn, when this event is the result of the tool that showed it. */
function previewOf(event: { type: string; data: unknown }): { id: string; text: string } | undefined {
  if (event.type !== 'tool/result') return undefined
  const { message } = event.data as { message: { toolCallId: string; content: readonly { type: string; text?: string }[] } }
  const text = decodePreview(textOf(message.content))
  return text === undefined ? undefined : { id: String(message.toolCallId), text }
}

/** The opening the game master showed while the turn was worked out; the view drops it once the output is there. */
export const chatPreview: ConversationNodeDefinition<PreviewState> = {
  kind: PREVIEW_NODE,
  target: 'chat',
  match: (event) => {
    const found = previewOf(event)
    return found === undefined ? null : { id: found.id, role: 'start' }
  },
  start: (_context, match) => {
    const found = previewOf(match.event)
    if (found === undefined) throw new Error('roleplay-preview starts with the result of the tool that shows it')
    return { seq: match.event.seq, data: { text: found.text } }
  },
  update: context => context.state as PreviewState,
  publication: () => 'immediate',
  buildViewNode: (context) => {
    const state = context.state
    if (state === undefined) return null
    return { key: context.key, kind: PREVIEW_NODE, id: context.id, target: 'chat', anchorSeq: state.seq, location: SESSION, visibility: 'visible', data: state.data }
  },
}
