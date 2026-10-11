import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { mkdir, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { defineTool, type ToolDefinition } from '@deepseek-ai/dsh-tools'
import { listFiles, promptProblem, PROMPTS_FOLDER, shippedPromptsDirectory, languageOf } from '../prompts/library.ts'
import type { AuthoredWorldReader } from './read-tools.ts'

/** The prompts that decide how the story is written and who the models are (prose and persona); every other prompt holds rules of the game. */
export const PROSE_PROMPTS: readonly string[] = ['roleplay/persona', 'roleplay/style', 'roleplay/character-style']

export const PROMPT_MUTATION_TOOLS = ['write_world_prompt', 'delete_world_prompt'] as const

const output = (value: unknown) => [{ type: 'text' as const, text: JSON.stringify(value, null, 2) }]
const jsonOutput = { schema: { type: 'json' as const }, render: (_args: unknown, value: unknown) => output(value) }
const idParameter = { type: 'string' as const, required: true as const, description: 'The prompt id from list_world_prompts, such as roleplay/style.' }
const languageParameter = { type: 'string' as const, required: true as const, description: 'The language folder, such as en or zh.' }

function shippedFile(shipped: string, language: string, id: string): string | undefined {
  return [language, 'en'].map(name => join(shipped, name, `${id}.md`)).find(path => existsSync(path))
}

function fileOf(directory: string, language: string, id: string): string {
  const problem = promptProblem(language, id, 'x', shippedPromptsDirectory())
  if (!id.startsWith('roleplay/')) throw new Error(`"${id}" is not a prompt of the story; the ones that can be carried are listed by list_world_prompts`)
  if (problem !== undefined && problem.startsWith('there is no prompt')) throw new Error(problem)
  return join(directory, PROMPTS_FOLDER, language, `${id}.md`)
}

/**
 * Read and write the prompts a world carries, which replace the shipped ones in the sessions started from it. The files are the
 * ones the session start copies, so they are checked as it checks them.
 */
export function worldPromptTools(reader: AuthoredWorldReader, shipped: string = shippedPromptsDirectory()): ToolDefinition[] {
  const language = (value: string): string => languageOf(value)
  return [
    defineTool({
      name: 'list_world_prompts',
      description: 'List the prompts the models are given, in a language, and whether this world carries its own version. "prose" prompts set how the story is written and how the models stay in character; "rules" prompts hold the rules of the game and the tools.',
      parameters: { language: languageParameter },
      output: jsonOutput,
      isConcurrencySafe: () => true,
      async execute(args, exec) {
        const { record } = await reader.read(exec)
        const tag = language(args.language)
        const ids = readdirSync(join(shipped, 'en'), { withFileTypes: true }).filter(entry => entry.isDirectory() && entry.name !== 'import' && entry.name !== 'world').flatMap(entry => listFiles(join(shipped, 'en', entry.name), `${entry.name}/`))
        return ids.sort().map(id => ({ id, kind: PROSE_PROMPTS.includes(id) ? 'prose' : 'rules', carried: existsSync(join(record.directory, PROMPTS_FOLDER, tag, `${id}.md`)) })) as never
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
        const tag = language(args.language)
        const own = fileOf(record.directory, tag, args.id)
        if (existsSync(own)) return { id: args.id, language: tag, carried: true, text: readFileSync(own, 'utf8') } as never
        const original = shippedFile(shipped, tag, args.id)
        return { id: args.id, language: tag, carried: false, text: original === undefined ? '' : readFileSync(original, 'utf8') } as never
      },
    }),
    defineTool({
      name: 'write_world_prompt',
      description: 'Create or replace the world\'s own version of a prompt. It must be a prompt from list_world_prompts, not empty, and use only the ${variables} the original uses; tool names and field names in it must stay as they are. Read it first and change only what is needed. Requires user approval.',
      parameters: { id: idParameter, language: languageParameter, text: { type: 'string', required: true, description: 'The complete prompt text.' } },
      output: jsonOutput,
      async execute(args, exec) {
        const { record } = await reader.read(exec)
        const tag = language(args.language)
        const file = fileOf(record.directory, tag, args.id)
        const problem = promptProblem(tag, args.id, args.text, shipped)
        if (problem !== undefined) throw new Error(problem)
        await mkdir(dirname(file), { recursive: true })
        const temporary = `${file}.tmp`
        await writeFile(temporary, args.text.endsWith('\n') ? args.text : `${args.text}\n`)
        await rename(temporary, file)
        return { action: 'written', id: args.id, language: tag } as never
      },
    }),
    defineTool({
      name: 'delete_world_prompt',
      description: 'Remove the world\'s own version of a prompt, so that sessions use the shipped one again. The file is moved into the world\'s .trash directory. Requires user approval.',
      parameters: { id: idParameter, language: languageParameter },
      output: jsonOutput,
      async execute(args, exec) {
        const { record } = await reader.read(exec)
        const tag = language(args.language)
        const file = fileOf(record.directory, tag, args.id)
        if (!existsSync(file)) throw new Error(`the world carries no prompt "${args.id}" in ${tag}`)
        const aside = join(record.directory, '.trash', PROMPTS_FOLDER, tag, `${args.id}.${Date.now()}.md`)
        await mkdir(dirname(aside), { recursive: true })
        await rename(file, aside)
        await rm(dirname(file), { recursive: false }).catch(() => undefined)
        return { action: 'deleted', id: args.id, language: tag, trashPath: aside } as never
      },
    }),
  ]
}
