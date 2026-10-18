import { existsSync } from 'node:fs'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-system-prompt'
import { defineTool, type PreToolDecision, type ToolDefinition, type ToolExecution } from '@deepseek-ai/dsh-tools'
import { SessionId } from '@deepseek-ai/dsh-session'
import { createTools, isSessionId, sessionDatabase, sessionFolder, type AgentLink } from '@dsh-agentic-roleplay/state'
import { chatSessionId } from './shared/chat.ts'
import { doctorSessionOf } from './shared/doctor-chat.ts'
import { keepBeforeEdit, undoLastEdit, type UndoDeps } from './host/agent/doctor-undo.ts'
import { externalToolLimit } from './host/orchestration/hooks.ts'
import { externalTools } from './host/tools/external.ts'
import { liveSettings } from './host/sessions/settings.ts'
import { FALLBACK_LANGUAGE } from './host/prompts/library.ts'
import type {} from './host/prompts/library.ts'
import type {} from './host/storage/roleplay-root.ts'

export const name = '@dsh-agentic-roleplay/core/doctor'
export const inject = ['roleplayState', 'roleplayRoot', 'roleplayPrompts', 'roleplayOrchestration', 'tools', 'systemPrompt', 'agents']

const DOCTOR_TOOL = 'edit_records'
const UNDO_TOOL = 'undo_last_edit'
const SHOWN_EDIT = 700

/** What the person is asked to approve: the edit, as it will be applied. */
export function doctorApproval(exec: ToolExecution): PreToolDecision | undefined {
  if (exec.agent === undefined || doctorSessionOf(exec.agent.session.id) === undefined) return undefined
  if (exec.name === UNDO_TOOL) return { kind: 'ask', reason: 'put the story back as it was before my last edit', displayReason: { en: 'Put the story back as it was before the last edit?', zh: '把故事恢复到上一次修改之前？' } }
  if (exec.name !== DOCTOR_TOOL) return undefined
  const { turn: _turn, ...edit } = exec.arguments as Record<string, unknown>
  if (Object.keys(edit).length === 0) return { kind: 'deny', reason: 'the edit changes nothing: put what to change in it (for example states, beliefs, relationships, item_changes)' }
  const text = JSON.stringify(edit)
  const shown = text.length > SHOWN_EDIT ? `${text.slice(0, SHOWN_EDIT)}…` : text
  return {
    kind: 'ask',
    reason: `change the story's records: ${shown}`,
    displayReason: { en: `Change the story's records?\n${shown}`, zh: `修改故事的记录？\n${shown}` },
  }
}

export function apply(ctx: Context): void {
  const sessionsDir = () => join(ctx.roleplayRoot.path, 'sessions')
  const resolve = (chat: string): AgentLink | undefined => {
    const id = doctorSessionOf(chat)
    if (id === undefined || !isSessionId(id) || !existsSync(sessionDatabase(sessionsDir(), id))) return undefined
    const session = ctx.roleplayState.openSession(sessionsDir(), id)
    const settings = liveSettings(sessionFolder(sessionsDir(), id))
    return { session, turn: session.metadata.get().turns, policy: settings.memory, timeZone: settings.clock.timeZone }
  }
  // The reading tools every agent has reach this chat's story through the same link; only the edit is the doctor's own.
  ctx.effect(() => ctx.roleplayState.bind(resolve), 'roleplay: session doctor reads')
  const undo: UndoDeps = {
    state: ctx.roleplayState,
    sessionsDir,
    busy: id => { const agent = ctx.agents.get(SessionId(chatSessionId(id))); return agent !== undefined && agent.status !== 'idle' },
    halt: id => ctx.roleplayOrchestration.halt(chatSessionId(id)),
  }
  for (const tool of createTools(resolve, { write: true }).filter(candidate => candidate.name === DOCTOR_TOOL)) ctx.tools.register(inTurn(tool, resolve, id => keepBeforeEdit(undo, id)))
  ctx.tools.register(undoTool(undo))
  ctx.on('tools/pre-execute', async (exec, next) => doctorApproval(exec) ?? await next())
  ctx.on('agent/created', ({ agent }) => {
    if (doctorSessionOf(agent.session.id) !== undefined && agent.session.header.origin !== 'subagent') externalToolLimit(agent, externalTools(agent.ctx.tools).map(tool => tool.name))
  })
  const languageOf = (context: object): string => {
    const chat = (context as { agent?: Agent }).agent?.session.id
    const id = chat === undefined ? undefined : doctorSessionOf(chat)
    return id !== undefined && isSessionId(id) && existsSync(sessionDatabase(sessionsDir(), id)) ? liveSettings(sessionFolder(sessionsDir(), id)).prompts.language : FALLBACK_LANGUAGE
  }
  for (const [section, order, id] of [
    ['SESSION_DOCTOR_PERSONA', ctx.systemPrompt.getSectionOrder('DEPLOYMENT_PERSONA_PREFIX'), 'doctor/persona'],
    ['SESSION_DOCTOR_PROCEDURE', ctx.systemPrompt.getSectionOrder('DEPLOYMENT_PERSONA_SUFFIX'), 'doctor/procedure'],
  ] as const) {
    ctx.systemPrompt.section({ name: section, order, interpolate: false, text: context => ctx.roleplayPrompts.text(id, languageOf(context)) })
  }
}

/** The edit is written at the turn the story is at (the first, in a story with none played), whatever turn the model put in it. */
function inTurn(tool: ToolDefinition, resolve: (chat: string) => AgentLink | undefined, keep: (id: string) => void): ToolDefinition {
  return {
    ...tool,
    async execute(args, exec) {
      const link = exec.agent === undefined ? undefined : resolve(exec.agent.session.id)
      const story = exec.agent === undefined ? undefined : doctorSessionOf(exec.agent.session.id)
      // Only an approved edit reaches here: what it replaces is kept first, so one step back is always possible.
      if (story !== undefined) keep(story)
      return await tool.execute(link === undefined ? args : { ...(args as object), turn: Math.max(1, link.turn) }, exec)
    },
  } as ToolDefinition
}

function undoTool(deps: UndoDeps): ToolDefinition {
  return defineTool({
    name: UNDO_TOOL,
    description: 'Put the story back as it was before the last edit you applied, when that edit turned out wrong. Only possible while no turn has been played since, and only once: the player is asked first.',
    parameters: {},
    output: { schema: { type: 'json' }, render: (_args, value) => [{ type: 'text' as const, text: (value as { text: string }).text }] },
    isConcurrencySafe: () => false,
    async execute(_args, exec) {
      const story = exec.agent === undefined ? undefined : doctorSessionOf(exec.agent.session.id)
      if (story === undefined) throw new Error('this tool is for a session doctor chat')
      await undoLastEdit(deps, story)
      return { text: 'The story is as it was before the last edit. Read the records again before saying what stands.' } as never
    },
  })
}
