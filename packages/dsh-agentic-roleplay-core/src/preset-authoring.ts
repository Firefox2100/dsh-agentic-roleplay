import { existsSync } from 'node:fs'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { limitAuthoringAgents } from './host/tools/authoring-tools.ts'
import { guardAuthoringTurns } from './host/authoring/turn-guard.ts'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-system-prompt'
import type {} from '@deepseek-ai/dsh-tools'
import { presetOfChat } from './shared/preset-chat.ts'
import { PresetReader, presetApproval, presetAuthorTools } from './host/authoring/preset-author-tools.ts'
import type {} from './host/import/service.ts'
import { PROMPTS_FOLDER, FALLBACK_LANGUAGE } from './host/prompts/library.ts'
import type {} from './host/prompts/library.ts'
import { presetDirectory } from './host/presets/presets.ts'
import type {} from './host/storage/roleplay-root.ts'
import type {} from './host/worlds/authoring-language.ts'

export const name = '@dsh-agentic-roleplay/core/preset-authoring'
export const inject = ['roleplayRoot', 'roleplayImport', 'roleplayPrompts', 'roleplayAuthoringLanguages', 'roleplayAuthoringTools', 'tools', 'systemPrompt']

/** The preset authoring chat: reads and writes the prose prompts of one library preset, each write approved by the person. */
export function apply(ctx: Context): void {
  const library = () => ctx.roleplayRoot.path
  const reader = new PresetReader(library)
  const prompting = { prompts: () => ctx.roleplayPrompts, languages: () => ctx.roleplayAuthoringLanguages }
  for (const tool of presetAuthorTools(reader, () => ctx.roleplayImport.settings, prompting)) ctx.tools.register(tool)
  const carries = (chat: string): boolean => {
    const preset = presetOfChat(chat)
    return preset !== undefined && existsSync(join(presetDirectory(library(), preset), PROMPTS_FOLDER))
  }
  limitAuthoringAgents(ctx, chat => (presetOfChat(chat) === undefined ? undefined : 'presetAuthoring'))
  guardAuthoringTurns(ctx, () => ctx.roleplayPrompts, (chat) => { const preset = presetOfChat(chat); return preset === undefined ? undefined : ctx.roleplayAuthoringLanguages.get(`preset:${preset}`) }, () => ctx.roleplayImport.settings.reasoning)
  ctx.on('tools/pre-execute', (exec, next) => presetApproval(exec, next, carries))
  const languageOf = (context: object): string => {
    const chat = (context as { agent?: Agent }).agent?.session.id
    const preset = chat === undefined ? undefined : presetOfChat(chat)
    return preset === undefined ? FALLBACK_LANGUAGE : ctx.roleplayAuthoringLanguages.get(`preset:${preset}`)
  }
  for (const [section, order, id] of [
    ['PRESET_AUTHORING_PERSONA', ctx.systemPrompt.getSectionOrder('DEPLOYMENT_PERSONA_PREFIX'), 'preset/persona'],
    ['PRESET_AUTHORING_PROCEDURE', ctx.systemPrompt.getSectionOrder('DEPLOYMENT_PERSONA_SUFFIX'), 'preset/procedure'],
  ] as const) {
    ctx.systemPrompt.section({ name: section, order, interpolate: false, text: context => ctx.roleplayPrompts.text(id, languageOf(context)) })
  }
}
