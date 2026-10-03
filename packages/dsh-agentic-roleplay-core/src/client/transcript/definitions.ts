import type { ConversationNodeContext, ConversationNodeDefinition } from '@deepseek-ai/dsh-client-ui-conversation/client'
import { decodeOutput, type NarrationSegment } from '../../shared/narration.ts'

export const NARRATION_NODE = 'roleplay-narration'

/** What a narration node carries. */
export interface NarrationNodeData {
  segments: readonly NarrationSegment[]
  repaired: boolean
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
