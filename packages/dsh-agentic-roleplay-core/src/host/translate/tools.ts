import { defineTool, type ToolDefinition } from '@deepseek-ai/dsh-tools'
import type { WorldCatalog } from '../worlds/catalog.ts'
import { contextOf, worldOf, type Prompting } from '../import/tools.ts'
import type { ImportSettings } from '../import/service.ts'
import { isStoryLanguage, STORY_LANGUAGES, type StoryLanguage } from './language.ts'
import { translateWorld } from './translate-world.ts'

export const TRANSLATE_TOOL = 'translate_world'

/** The message that has the authoring chat translate its world, in the language of the person who asked. */
export function translateMessage(text: (id: string, variables?: Record<string, string | number>) => string, to: StoryLanguage, language: StoryLanguage): string {
  return text('translate/notice', { tool: TRANSLATE_TOOL, code: to, to: to === 'zh' ? (language === 'zh' ? '中文' : 'Chinese') : (language === 'zh' ? '英文' : 'English') })
}

/** The tool of the authoring chat that translates the chat's world into a copy in another language. */
export function translateTools(worlds: WorldCatalog, settings: () => ImportSettings, prompting: Prompting): ToolDefinition[] {
  return [
    defineTool({
      name: TRANSLATE_TOOL,
      description: 'Makes a translated copy of this world, next to it, in another language: its names first, so every file calls each person, place and thing the same, then the words of every file. The world itself is not changed. Takes several minutes. Use it only when the person asked for a translation.',
      parameters: { language: { type: 'string', required: true, enum: [...STORY_LANGUAGES], description: 'The language to translate into: en or zh.' } },
      output: { schema: { type: 'json' as const }, render: (_args: unknown, value: unknown) => [{ type: 'text' as const, text: JSON.stringify(value, null, 1) }] },
      isConcurrencySafe: () => false,
      async execute(args, exec) {
        if (!isStoryLanguage(args.language)) throw new Error(`language must be one of: ${STORY_LANGUAGES.join(', ')}`)
        const world = await worldOf(worlds, exec)
        const told = prompting.languages().get(world.id)
        const text = (id: string, variables?: Record<string, string | number>): string => prompting.prompts().text(id, told, variables)
        const report = await translateWorld(contextOf(exec, settings(), text, told), worlds, world, args.language, told.startsWith('zh') ? 'zh' : 'en')
        return JSON.parse(JSON.stringify(report)) as never
      },
    }),
  ]
}
