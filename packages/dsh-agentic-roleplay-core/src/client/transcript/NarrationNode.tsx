import type { ChatNode } from '@deepseek-ai/dsh-client-ui-chat/client'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import { NarrationView } from './NarrationView.tsx'
import { SceneImages } from './SceneImages.tsx'

/** The output of a turn inside the normal Chat; the Chat gives its own translator, so ours comes from outside. */
export function narrationNode(t: TranslateNS<'roleplay.transcript'>) {
  return function NarrationNode({ node, sessionId }: { node: ChatNode<'roleplay-narration'>; sessionId: string }) {
    return <><NarrationView data={node.data} t={t} />{node.data.timelineNode !== undefined && <SceneImages chat={sessionId} node={node.data.timelineNode} t={t} />}</>
  }
}
