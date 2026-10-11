import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-subagent'
import type {} from '@deepseek-ai/dsh-system-prompt'
import type {} from '@deepseek-ai/dsh-tools'
import type {} from 'dsh-roleplay-state'
import type { ImageGenerationService } from 'dsh-ai-core'
import { join } from 'node:path'
import { SessionId } from '@deepseek-ai/dsh-session'
import { recordKeeper } from './host/orchestration/committer.ts'
import { Timelines } from './host/timeline/service.ts'
import { suggestionWriter } from './host/orchestration/suggester.ts'
import { worldAuthor } from './host/authoring/author-agent.ts'
import { installHooks } from './host/orchestration/hooks.ts'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { PERSONA_SECTION, PROTOCOL_SECTION } from './host/orchestration/prompt.ts'
import { roleplaySessionOf } from './shared/chat.ts'
import { liveSettings } from './host/sessions/settings.ts'
import { storesOf } from './host/orchestration/store.ts'
import { sessionFolder } from 'dsh-roleplay-state'
import { FALLBACK_LANGUAGE } from './host/prompts/library.ts'
import { currentTurn } from './host/orchestration/current-turn.ts'
import { createTools } from './host/orchestration/tools.ts'
import { EmbeddingIndex, type Embedder } from './host/memory/embedding-index.ts'
import { rerankMemories, type Reranker } from './host/memory/rerank-memories.ts'
import { TurnEngine } from './host/orchestration/turn-engine.ts'
import { ImageJobs } from './host/images/jobs.ts'
import type {} from './host/orchestration/service.ts'
import type {} from './host/storage/roleplay-root.ts'

export const name = 'dsh-agentic-roleplay-core/orchestration'

/**
 * Mounted by the `roleplay` agent preset, so it applies to roleplay chats only.
 * One instance serves every chat of the preset: state is kept per chat.
 */
export const inject = ['roleplayOrchestration', 'roleplayState', 'roleplayRoot', 'roleplayPrompts', 'tools', 'subagents', 'systemPrompt', 'agents']

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
  const stores = storesOf(ctx.roleplayState, sessionsDir, problem, (chat, text, signal) => index.queryVector(chat, text, signal), undefined, (language, id, variables) => ctx.roleplayPrompts.text(id, language, variables))
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
  const languageOf = (context: object): string => {
    const chat = (context as { agent?: Agent }).agent?.session.id
    const id = chat === undefined ? undefined : roleplaySessionOf(chat)
    return id === undefined ? FALLBACK_LANGUAGE : liveSettings(sessionFolder(sessionsDir(), id), problem).prompts.language
  }
  for (const [name, order, id] of [
    [PERSONA_SECTION, ctx.systemPrompt.getSectionOrder('DEPLOYMENT_PERSONA_PREFIX'), 'roleplay/persona'],
    [PROTOCOL_SECTION, ctx.systemPrompt.getSectionOrder('DEPLOYMENT_PERSONA_SUFFIX'), 'roleplay/game-master'],
  ] as const) {
    ctx.systemPrompt.section({ name, order, text: context => ctx.roleplayPrompts.text(id, languageOf(context)), interpolate: false })
  }
  for (const tool of createTools({ engine, boundaries, stores, turnOf: currentTurn, delivered: (chat, output) => { const node = timelines.delivered(chat, output); if (node !== undefined) images.afterDelivery(chat, node, output); return node } })) ctx.tools.register(tool)
  ctx.effect(() => { ctx.roleplayOrchestration.settle = chat => engine.idle(chat); return () => { ctx.roleplayOrchestration.settle = () => Promise.resolve() } }, 'roleplay: settle records')
  let imageJobs: ImageJobs | undefined
  const timelines = new Timelines({
    state: ctx.roleplayState,
    sessionsDir,
    engine,
    agentOf: chat => Promise.resolve(ctx.agents.get(SessionId(chat))),
    keepSnapshots: id => liveSettings(sessionFolder(sessionsDir(), id), problem).rewind.keepSnapshots,
    cancel: chat => imageJobs?.cancel(chat),
  })
  const images = new ImageJobs({
    state: ctx.roleplayState,
    sessionsDir,
    timelines,
    service: () => (ctx as Context & { get(name: 'imageGeneration'): ImageGenerationService | undefined }).get('imageGeneration'),
    agentOf: chat => ctx.agents.get(SessionId(chat)),
    settings: id => liveSettings(sessionFolder(sessionsDir(), id), problem),
    problem,
  })
  imageJobs = images
  ctx.effect(() => {
    ctx.roleplayOrchestration.halt = async (chat) => { images.cancel(chat); engine.stop(chat); await engine.quiesce(chat); engine.forget(chat) }
    return () => { ctx.roleplayOrchestration.halt = () => Promise.resolve() }
  }, 'roleplay: halt')
  ctx.effect(() => { ctx.roleplayOrchestration.timelines = timelines; return () => { ctx.roleplayOrchestration.timelines = undefined } }, 'roleplay: timelines')
  ctx.effect(() => { ctx.roleplayOrchestration.images = images; return () => { ctx.roleplayOrchestration.images = undefined } }, 'roleplay: images')
  installHooks(ctx, { engine, boundaries, stores, timelines })
}
