import { existsSync } from 'node:fs'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-system-prompt'
import type { PreToolDecision, ToolDefinition, ToolExecution } from '@deepseek-ai/dsh-tools'
import { createTools, isSessionId, sessionDatabase, sessionFolder, type AgentLink } from '@dsh-agentic-roleplay/state'
import { doctorSessionOf } from './shared/doctor-chat.ts'
import { externalToolLimit } from './host/orchestration/hooks.ts'
import { externalTools } from './host/tools/external.ts'
import { liveSettings } from './host/sessions/settings.ts'
import { FALLBACK_LANGUAGE } from './host/prompts/library.ts'
import type {} from './host/prompts/library.ts'
import type {} from './host/storage/roleplay-root.ts'

export const name = '@dsh-agentic-roleplay/core/doctor'
export const inject = ['roleplayState', 'roleplayRoot', 'roleplayPrompts', 'tools', 'systemPrompt']

const DOCTOR_TOOL = 'edit_records'
const SHOWN_EDIT = 700

/** What the person is asked to approve: the edit, as it will be applied. */
export function doctorApproval(exec: ToolExecution): PreToolDecision | undefined {
  if (exec.name !== DOCTOR_TOOL || exec.agent === undefined || doctorSessionOf(exec.agent.session.id) === undefined) return undefined
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
  for (const tool of createTools(resolve, { write: true }).filter(candidate => candidate.name === DOCTOR_TOOL)) ctx.tools.register(inTurn(tool, resolve))
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
function inTurn(tool: ToolDefinition, resolve: (chat: string) => AgentLink | undefined): ToolDefinition {
  return { ...tool, async execute(args, exec) { const link = exec.agent === undefined ? undefined : resolve(exec.agent.session.id); return await tool.execute(link === undefined ? args : { ...(args as object), turn: Math.max(1, link.turn) }, exec) } } as ToolDefinition
}
