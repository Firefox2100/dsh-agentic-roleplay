import { defineTool, type ToolDefinition } from '@deepseek-ai/dsh-tools'
import { shippedPromptsDirectory } from '../prompts/library.ts'
import { deleteWorldPrompt, listWorldPrompts, PROSE_PROMPTS, readWorldPrompt, writeWorldPrompt } from '../prompts/world-prompts.ts'
import type { AuthoredWorldReader } from './read-tools.ts'

export { PROSE_PROMPTS }

export const PROMPT_MUTATION_TOOLS = ['write_world_prompt', 'delete_world_prompt'] as const

const output = (value: unknown) => [{ type: 'text' as const, text: JSON.stringify(value, null, 2) }]
const jsonOutput = { schema: { type: 'json' as const }, render: (_args: unknown, value: unknown) => output(value) }
const idParameter = { type: 'string' as const, required: true as const, description: 'The prompt id from list_world_prompts, such as roleplay/style.' }
const languageParameter = { type: 'string' as const, required: true as const, description: 'The language folder, such as en or zh.' }

/**
 * Read and write the prompts a world carries, which replace the shipped ones in the sessions started from it. The files are the
 * ones the session start copies, so they are checked as it checks them.
 */
export function worldPromptTools(reader: AuthoredWorldReader, shipped: string = shippedPromptsDirectory()): ToolDefinition[] {
  return [
    defineTool({
      name: 'list_world_prompts',
      description: 'List the prompts the models are given, in a language, and whether this world carries its own version. "prose" prompts set how the story is written and how the models stay in character; "rules" prompts hold the rules of the game and the tools.',
      parameters: { language: languageParameter },
      output: jsonOutput,
      isConcurrencySafe: () => true,
      async execute(args, exec) {
        const { record } = await reader.read(exec)
        return listWorldPrompts(record.directory, args.language, shipped) as never
      },
    }),
    defineTool({
      name: 'read_world_prompt',
      description: 'Read a prompt as sessions of this world will get it: the world\'s own version when it carries one, otherwise the shipped text. ${name} marks a value the program fills in.',
      parameters: { id: idParameter, language: languageParameter },
      output: jsonOutput,
      isConcurrencySafe: () => true,
      async execute(args, exec) {
        const { record } = await reader.read(exec)
        return readWorldPrompt(record.directory, args.language, args.id, shipped) as never
      },
    }),
    defineTool({
      name: 'write_world_prompt',
      description: 'Create or replace the world\'s own version of a prompt. It must be a prompt from list_world_prompts, not empty, and use only the ${variables} the original uses; tool names and field names in it must stay as they are. Read it first and change only what is needed. Requires user approval.',
      parameters: { id: idParameter, language: languageParameter, text: { type: 'string', required: true, description: 'The complete prompt text.' } },
      output: jsonOutput,
      async execute(args, exec) {
        const { record } = await reader.read(exec)
        await writeWorldPrompt(record.directory, args.language, args.id, args.text, shipped)
        return { action: 'written', id: args.id, language: args.language } as never
      },
    }),
    defineTool({
      name: 'delete_world_prompt',
      description: 'Remove the world\'s own version of a prompt, so that sessions use the shipped one again. The file is moved into the world\'s .trash directory. Requires user approval.',
      parameters: { id: idParameter, language: languageParameter },
      output: jsonOutput,
      async execute(args, exec) {
        const { record } = await reader.read(exec)
        const trashPath = await deleteWorldPrompt(record.directory, args.language, args.id, shipped)
        return { action: 'deleted', id: args.id, language: args.language, trashPath } as never
      },
    }),
  ]
}
