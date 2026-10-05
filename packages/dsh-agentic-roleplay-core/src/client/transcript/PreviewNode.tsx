import type { ChatNodeViewProps } from '@deepseek-ai/dsh-client-ui-chat/client'
import { NARRATION_NODE } from './definitions.ts'
import css from './NarrationView.module.css'

interface NodeLike {
  kind?: string
  anchorSeq?: number
}

/**
 * How the game master opened the scene while the rest of the turn was worked out. Once the output of the turn
 * has arrived (a later narration), the view no longer shows it: the log keeps both.
 */
export function PreviewNode({ node, useChat }: Pick<ChatNodeViewProps<'roleplay-preview'>, 'node' | 'useChat'>) {
  const replaced = useChat(chat => [...(chat.nodes.values() as Iterable<NodeLike>)].some(other => other.kind === NARRATION_NODE && (other.anchorSeq ?? 0) > (node.anchorSeq ?? 0)))
  if (replaced) return null
  return (
    <div className={css.output} data-testid="roleplay-preview">
      <p className={`${css.narration} ${css.preview}`}>{node.data.text}</p>
    </div>
  )
}
