import { join } from 'node:path'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { CompactionResult, CompactionTrigger } from '@deepseek-ai/dsh-compaction'
import BasicCompactionEngine from '@deepseek-ai/dsh-compaction-basic'
import type { SessionId } from '@deepseek-ai/dsh-session'
import type { Context } from '@deepseek-ai/cordis'
import type { ContentBlock, Message } from '@deepseek-ai/dsh-llm'
import type {} from '@deepseek-ai/dsh-token-meter'
import type {} from '@deepseek-ai/dsh-subagent'
import { sessionFolder } from '@dsh-agentic-roleplay/state'
import { decodeOutput } from '../../shared/narration.ts'
import { roleplaySessionOf } from '../../shared/chat.ts'
import { liveSettings } from '../sessions/settings.ts'
import { composeSummary, foldSummaries, type Chronicler } from './chronicle.ts'
import { promptFor } from '../prompts/access.ts'
import { subagentChronicler } from './chronicler.ts'
import { selectFoldRange } from './range.ts'

/** What the next summary has to cover; set by the engine just before it asks DSH to fold a range. */
interface Fold {
  uptoTurn: number
  folder: string
  id: string
}

/** Folding more often than this size is pointless, whatever the window. */
const MIN_LIMIT = 4000

const textOf = (content: readonly ContentBlock[]): string => content.flatMap(block => (block.type === 'text' ? [block.text] : [])).join('\n')

/**
 * What the player did and what the conversation told, read from the messages that are
 * being folded: the player's own messages, and the delivered outputs of the turns.
 */
export function readFolded(messages: readonly Message[]): { playerInputs: string; transcript: string } {
  const player: string[] = []
  const told: string[] = []
  for (const message of messages) {
    const text = textOf(message.content)
    if (message.role === 'user' && message.source.kind === 'user') {
      player.push(`- ${text.trim()}`)
      told.push(`Player: ${text.trim()}`)
    } else if (message.role === 'tool') {
      const output = decodeOutput(text)
      if (output !== undefined) told.push(output.segments.map(segment => (segment.type === 'utterance' ? `${segment.name}: "${segment.text}"` : segment.text)).join('\n'))
    }
  }
  return { playerInputs: player.join('\n'), transcript: told.join('\n\n') }
}

/**
 * Compaction for roleplay chats. The conversation is sent whole until it passes the chat's
 * limit; then the oldest whole turns are folded into the summaries and leave the surface,
 * so the head of the conversation changes once in many turns and the provider's cache
 * holds in between. The summaries are written from the events the record keeper stored,
 * not from the earlier summary text. Everything else (the surface replacement, the log
 * markers, pairing of tool calls) is DSH's own compaction.
 */
export class RoleplayCompaction extends BasicCompactionEngine {
  static override inject = [...BasicCompactionEngine.inject, 'roleplayState', 'roleplayRoot', 'subagents']

  private readonly folds = new Map<SessionId, Fold>()

  constructor(ctx: Context, config: ConstructorParameters<typeof BasicCompactionEngine>[1] = {}) {
    super(ctx, config)
  }

  private sessionsDir(): string {
    return join(this.ctx.roleplayRoot.path, 'sessions')
  }

  override async compactIfNeeded(agent: Agent, trigger: CompactionTrigger, signal: AbortSignal): Promise<CompactionResult | null> {
    const id = roleplaySessionOf(agent.session.id)
    if (id === undefined || agent.session.header.origin === 'subagent') return null
    const folder = sessionFolder(this.sessionsDir(), id)
    const { context } = liveSettings(folder, message => { this.ctx.logger.warn(`roleplay: ${message}`) })
    const measurement = this.ctx.tokenMeter.measure(agent.session)
    const limit = await this.limitOf(agent, context, signal)
    if (trigger === 'pressure' && measurement.totalTokens < limit) return null
    const events = agent.session.snapshotEvents()
    const range = selectFoldRange({ events, nodes: measurement.nodes, retainTokens: Math.round(limit * context.retainRatio) })
    if (range === null) return null
    this.folds.set(agent.session.id, { uptoTurn: range.uptoTurn, folder, id })
    try {
      return await this.compactRegion(range.start, range.end, agent, signal)
    } finally {
      this.folds.delete(agent.session.id)
    }
  }

  /**
   * The size at which the conversation is folded: the chat's own limit, or, when it gives none, a share of the selected model's context window.
   * @throws {Error} when the chat gives no limit and the model's window is not known.
   */
  private async limitOf(agent: Agent, context: { limitTokens: number; limitRatio: number; workingTokens: number }, signal: AbortSignal): Promise<number> {
    if (context.limitTokens > 0) return context.limitTokens
    const config = agent.session.requestHeader()?.config
    if (config?.provider === undefined || config.model === undefined) throw new Error('the conversation limit follows the model, but this chat has none selected: set the limit in the chat settings')
    const window = (await this.ctx.llm.resolveModelInfo(config.provider, config.model, signal)).context?.contextWindow
    if (window === undefined) throw new Error(`the conversation limit follows the model, but the context window of ${config.provider}/${config.model} is not known: set the limit in the chat settings or the model's contextWindow in the provider`)
    const share = Math.round(window * context.limitRatio)
    return Math.max(MIN_LIMIT, context.workingTokens > 0 ? Math.min(share, context.workingTokens) : share)
  }

  protected override async summarize(input: { readonly messages: readonly Message[] }, agent: Agent, signal?: AbortSignal): Promise<{ summary: ContentBlock[]; provider: string; model: string }> {
    const fold = this.folds.get(agent.session.id)
    if (fold === undefined) return super.summarize(input as never, agent, signal)
    const story = this.ctx.roleplayState.openSession(this.sessionsDir(), fold.id)
    const { context, prompts } = liveSettings(fold.folder)
    const chronicler: Chronicler = subagentChronicler(this.ctx.subagents, agent, prompts.language)
    const { playerInputs, transcript } = readFolded(input.messages)
    await foldSummaries({ story, settings: context, uptoTurn: fold.uptoTurn, playerInputs, transcript, chronicler, text: (id, variables) => promptFor(agent, `roleplay/chronicle-${id}`, prompts.language, variables), signal: signal ?? new AbortController().signal })
    const config = agent.session.requestHeader()?.config
    return {
      summary: [{ type: 'text', text: composeSummary(story) }],
      provider: config?.provider ?? 'roleplay',
      model: config?.model ?? 'chronicler',
    }
  }
}

export default RoleplayCompaction
