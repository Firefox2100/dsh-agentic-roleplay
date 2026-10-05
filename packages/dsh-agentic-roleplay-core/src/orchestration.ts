import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-subagent'
import type {} from '@deepseek-ai/dsh-system-prompt'
import type {} from '@deepseek-ai/dsh-tools'
import type {} from 'dsh-roleplay-state'
import { join } from 'node:path'
import { SessionId } from '@deepseek-ai/dsh-session'
import { recordKeeper } from './host/orchestration/committer.ts'
import { suggestionWriter } from './host/orchestration/suggester.ts'
import { worldAuthor } from './host/authoring/author-agent.ts'
import { installHooks } from './host/orchestration/hooks.ts'
import { PROTOCOL, PROTOCOL_SECTION } from './host/orchestration/prompt.ts'
import { roleplaySessionOf } from './shared/chat.ts'
import { liveSettings } from './host/sessions/settings.ts'
import { storesOf } from './host/orchestration/store.ts'
import { sessionFolder } from 'dsh-roleplay-state'
import { currentTurn } from './host/orchestration/current-turn.ts'
import { createTools } from './host/orchestration/tools.ts'
import { EmbeddingIndex, type Embedder } from './host/memory/embedding-index.ts'
import { rerankMemories, type Reranker } from './host/memory/rerank-memories.ts'
import { TurnEngine } from './host/orchestration/turn-engine.ts'
import type {} from './host/orchestration/service.ts'
import type {} from './host/storage/roleplay-root.ts'

export const name = 'dsh-agentic-roleplay-core/orchestration'

/**
 * Mounted by the `roleplay` agent preset, so it applies to roleplay chats only.
 * One instance serves every chat of the preset: state is kept per chat.
 */
export const inject = ['roleplayOrchestration', 'roleplayState', 'roleplayRoot', 'tools', 'subagents', 'systemPrompt', 'agents']

export function apply(ctx: Context): void {
  const boundaries = () => ctx.roleplayOrchestration.boundaries
  const problem = (message: string): void => { ctx.logger.warn(`roleplay: ${message}`) }
  const sessionsDir = () => join(ctx.roleplayRoot.path, 'sessions')
  // The embedding plugin is optional: without it, or while it fails, memory is searched by words alone.
  const index = new EmbeddingIndex({
    embedder: () => (ctx as Context & { get(name: 'embeddings'): Embedder | undefined }).get('embeddings'),
    story: (chat) => {
      const id = roleplaySessionOf(chat)
      if (id === undefined) return undefined
      const folder = sessionFolder(sessionsDir(), id)
      return { story: ctx.roleplayState.openSession(sessionsDir(), id), options: () => liveSettings(folder, problem).embedding.options }
    },
    problem,
  })
  const stores = storesOf(ctx.roleplayState, sessionsDir, problem, (chat, text, signal) => index.queryVector(chat, text, signal))
  const engine = new TurnEngine(boundaries, stores, problem, chat => { index.schedule(chat) })

  // The ranker exists while a reranking service does, so that it never stands in the way of another plugin's ranker.
  ctx.inject(['rerankers'], (scope) => {
    scope.effect(() => ctx.roleplayState.rankMemories(rerankMemories({ reranker: () => (scope as Context & { rerankers: Reranker }).rerankers, problem })), 'roleplay: rerank memories')
  })
  ctx.effect(() => ctx.roleplayOrchestration.replace({ committer: recordKeeper({ agentOf: chat => ctx.agents.get(SessionId(chat)) }) }), 'roleplay: record keeper')
  ctx.effect(() => ctx.roleplayOrchestration.replace({ author: worldAuthor({ agentOf: chat => ctx.agents.get(SessionId(chat)) }) }), 'roleplay: world author')
  ctx.effect(() => ctx.roleplayOrchestration.replace({ suggester: suggestionWriter({ agentOf: chat => ctx.agents.get(SessionId(chat)) }) }), 'roleplay: suggestions')
  ctx.effect(() => ctx.roleplayState.bind((agentSessionId) => {
    const id = roleplaySessionOf(agentSessionId)
    const agent = ctx.agents.get(SessionId(agentSessionId))
    if (id === undefined || agent === undefined) return undefined
    return {
      session: ctx.roleplayState.openSession(sessionsDir(), id),
      turn: currentTurn(agent),
      policy: liveSettings(sessionFolder(sessionsDir(), id)).memory,
      queryVector: (text, signal) => index.queryVector(agentSessionId, text, signal),
    }
  }), 'roleplay: state tools')
  ctx.systemPrompt.section({
    name: PROTOCOL_SECTION,
    order: ctx.systemPrompt.getSectionOrder('DEPLOYMENT_PERSONA_SUFFIX'),
    text: PROTOCOL,
    interpolate: false,
  })
  for (const tool of createTools({ engine, boundaries, stores, turnOf: currentTurn })) ctx.tools.register(tool)
  ctx.effect(() => { ctx.roleplayOrchestration.settle = chat => engine.settle(chat); return () => { ctx.roleplayOrchestration.settle = () => Promise.resolve() } }, 'roleplay: settle records')
  installHooks(ctx, { engine, boundaries, stores })
}
