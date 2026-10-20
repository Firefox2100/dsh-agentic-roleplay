import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-system-prompt'
import type {} from '@deepseek-ai/dsh-tools'
import { lorebookOfChat } from './shared/lorebook-chat.ts'
import { LorebookReader, lorebookApproval, lorebookAuthorTools, pendingTargets } from './host/authoring/lorebook-author-tools.ts'
import type {} from './host/import/service.ts'
import { FALLBACK_LANGUAGE } from './host/prompts/library.ts'
import type {} from './host/prompts/library.ts'
import { lorebookDirectory } from './host/lorebooks/lorebooks.ts'
import type {} from './host/storage/roleplay-root.ts'
import type {} from './host/worlds/authoring-language.ts'

export const name = '@dsh-agentic-roleplay/core/lorebook-authoring'
export const inject = ['roleplayRoot', 'roleplayImport', 'roleplayPrompts', 'roleplayAuthoringLanguages', 'tools', 'systemPrompt']

/** The lorebook authoring chat: reads and writes the entries of one library lorebook, each write approved by the person. */
export function apply(ctx: Context): void {
  const library = () => ctx.roleplayRoot.path
  const reader = new LorebookReader(library)
  const prompting = { prompts: () => ctx.roleplayPrompts, languages: () => ctx.roleplayAuthoringLanguages }
  for (const tool of lorebookAuthorTools(reader, () => ctx.roleplayImport.settings, prompting)) ctx.tools.register(tool)
  const directoryOf = (chat: string): string | undefined => {
    const book = lorebookOfChat(chat)
    return book === undefined ? undefined : lorebookDirectory(library(), book)
  }
  const carries = (chat: string): boolean => {
    const directory = directoryOf(chat)
    return directory !== undefined && existsSync(join(directory, 'lore')) && readdirSync(join(directory, 'lore')).length > 0
  }
  const waiting = (chat: string) => { const directory = directoryOf(chat); return directory === undefined ? { ids: [], rules: false } : pendingTargets(directory) }
  ctx.on('tools/pre-execute', (exec, next) => lorebookApproval(exec, next, { carries, waiting }))
  const languageOf = (context: object): string => {
    const chat = (context as { agent?: Agent }).agent?.session.id
    const book = chat === undefined ? undefined : lorebookOfChat(chat)
    return book === undefined ? FALLBACK_LANGUAGE : ctx.roleplayAuthoringLanguages.get(`lorebook:${book}`)
  }
  for (const [section, order, id] of [
    ['LOREBOOK_AUTHORING_PERSONA', ctx.systemPrompt.getSectionOrder('DEPLOYMENT_PERSONA_PREFIX'), 'lorebook/persona'],
    ['LOREBOOK_AUTHORING_PROCEDURE', ctx.systemPrompt.getSectionOrder('DEPLOYMENT_PERSONA_SUFFIX'), 'lorebook/procedure'],
  ] as const) {
    ctx.systemPrompt.section({ name: section, order, interpolate: false, text: context => ctx.roleplayPrompts.text(id, languageOf(context)) })
  }
}
