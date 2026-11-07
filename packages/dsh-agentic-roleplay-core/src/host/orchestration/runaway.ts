import type { Agent } from '@deepseek-ai/dsh-agent'
import { ReasoningEffortId } from '@deepseek-ai/dsh-llm'
import { cutOff } from '../agents/cut-off.ts'

type Selection = NonNullable<ReturnType<Agent['model']['current']>>

/** The levels of thinking that mean none, as models name them. */
const NONE = ['off', 'none', 'minimal']

/**
 * A game master whose thinking ran on to the end of its output limit (found live: 12000 tokens, two and a half minutes, and a turn that ended without output) is asked to answer
 * without thinking for the rest of the turn, when its model offers that. The level it was on is put back at the first step of the next turn.
 */
export class RunawayThinking {
  private readonly before = new Map<string, Selection>()

  /** To be called before each step of a chat's game master. */
  async step(chat: string, agent: Agent, step: number): Promise<void> {
    const earlier = this.before.get(chat)
    if (earlier !== undefined && step === 1) {
      agent.model.select(earlier)
      this.before.delete(chat)
      return
    }
    if (step === 1 || earlier !== undefined || !cutOff(agent)) return
    const current = agent.model.current()
    if (current === undefined) return
    const info = await agent.ctx.llm.resolveModelInfo(current.provider, current.model, new AbortController().signal).catch(() => undefined)
    const level = info?.reasoning?.efforts.find(effort => NONE.includes(effort.id))
    if (level === undefined || current.reasoningEffort === level.id) return
    this.before.set(chat, current)
    agent.model.select({ ...current, reasoningEffort: ReasoningEffortId(level.id) })
  }
}
