import type { Context } from '@deepseek-ai/cordis'
import { limitAuthoringAgents } from './host/tools/authoring-tools.ts'
import type {} from '@deepseek-ai/dsh-system-prompt'
import type {} from '@deepseek-ai/dsh-tools'
import type {} from './host/worlds/catalog.ts'
import { AuthoredWorldReader, authoredWorldReadTools } from './host/authoring/read-tools.ts'
import { authoredWorldWriteTools, authoringApproval } from './host/authoring/write-tools.ts'
import { registerPackJail } from './host/authoring/pack-jail.ts'
import { worldPackTools } from './host/authoring/pack-tools.ts'
import { worldPromptTools } from './host/authoring/prompt-tools.ts'
import { importHooks, importTools } from './host/import/tools.ts'
import { presetTools } from './host/import/preset-tools.ts'
import { isReviewing } from './host/import/run-import.ts'
import { translateTools } from './host/translate/tools.ts'
import type {} from './host/import/service.ts'
import type {} from './host/prompts/library.ts'
import type {} from './host/worlds/authoring-language.ts'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { authoredWorldOf } from './shared/authoring-chat.ts'
import { FALLBACK_LANGUAGE } from './host/prompts/library.ts'

export const name = '@dsh-agentic-roleplay/core/authoring'
export const inject = ['roleplayWorlds', 'roleplayImport', 'roleplayPrompts', 'roleplayAuthoringLanguages', 'roleplayAuthoringTools', 'tools', 'systemPrompt']

export function apply(ctx: Context): void {
  const prompting = { prompts: () => ctx.roleplayPrompts, languages: () => ctx.roleplayAuthoringLanguages }
  const languageOf = (context: object): string => {
    const chat = (context as { agent?: Agent }).agent?.session.id
    const world = chat === undefined ? undefined : authoredWorldOf(chat)
    return world === undefined ? FALLBACK_LANGUAGE : ctx.roleplayAuthoringLanguages.get(world)
  }
  const reader = new AuthoredWorldReader(ctx.roleplayWorlds)
  for (const tool of authoredWorldReadTools(reader)) ctx.tools.register(tool)
  for (const tool of authoredWorldWriteTools(reader)) ctx.tools.register(tool)
  for (const tool of worldPromptTools(reader)) ctx.tools.register(tool)
  for (const tool of worldPackTools(reader)) ctx.tools.register(tool)
  for (const tool of importTools(ctx.roleplayWorlds, () => ctx.roleplayImport.settings, prompting)) ctx.tools.register(tool)
  for (const tool of presetTools(ctx.roleplayWorlds, () => ctx.roleplayImport.settings, prompting)) ctx.tools.register(tool)
  for (const tool of translateTools(ctx.roleplayWorlds, () => ctx.roleplayImport.settings, prompting)) ctx.tools.register(tool)
  importHooks(ctx, ctx.roleplayWorlds, prompting)
  const reviewing = async (chat: string): Promise<boolean> => {
    const id = authoredWorldOf(chat)
    const record = id === undefined ? undefined : await ctx.roleplayWorlds.find(id)
    return record !== undefined && await isReviewing(record.directory)
  }
  const worldDirectory = async (chat: string): Promise<string | undefined> => {
    const id = authoredWorldOf(chat)
    return id === undefined ? undefined : (await ctx.roleplayWorlds.find(id))?.directory
  }
  registerPackJail(ctx, { worldDirectory, reviewing })
  limitAuthoringAgents(ctx, chat => (authoredWorldOf(chat) === undefined ? undefined : 'worldAuthoring'))
  ctx.on('tools/pre-execute', (exec, next) => authoringApproval(exec, next, reviewing))
  for (const [name, order, id] of [
    ['WORLD_AUTHORING_PERSONA', ctx.systemPrompt.getSectionOrder('DEPLOYMENT_PERSONA_PREFIX'), 'world/persona'],
    ['WORLD_AUTHORING_PROCEDURE', ctx.systemPrompt.getSectionOrder('DEPLOYMENT_PERSONA_SUFFIX'), 'world/procedure'],
  ] as const) {
    ctx.systemPrompt.section({ name, order, interpolate: false, text: context => ctx.roleplayPrompts.text(id, languageOf(context)) })
  }
}
