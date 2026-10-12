import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { mkdir, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { languageOf, listFiles, promptProblem, PROMPTS_FOLDER, shippedPromptsDirectory } from './library.ts'

/** The prompts that decide how the story is written and who the models are (prose and persona); every other prompt holds rules of the game. */
export const PROSE_PROMPTS: readonly string[] = ['roleplay/persona', 'roleplay/style', 'roleplay/character-style']

export interface WorldPromptEntry {
  id: string
  kind: 'prose' | 'rules'
  /** Whether the world has its own version; otherwise sessions use the shipped text. */
  carried: boolean
}

function shippedFile(shipped: string, language: string, id: string): string | undefined {
  return [language, 'en'].map(name => join(shipped, name, `${id}.md`)).find(path => existsSync(path))
}

function fileOf(directory: string, language: string, id: string, shipped: string): string {
  const problem = promptProblem(language, id, 'x', shipped)
  if (!id.startsWith('roleplay/')) throw new Error(`"${id}" is not a prompt of the story; the ones that can be carried are listed by list_world_prompts`)
  if (problem !== undefined && problem.startsWith('there is no prompt')) throw new Error(problem)
  return join(directory, PROMPTS_FOLDER, language, `${id}.md`)
}

/** Every prompt of the story, in a language, and whether the world carries its own version. */
export function listWorldPrompts(directory: string, language: string, shipped: string = shippedPromptsDirectory()): WorldPromptEntry[] {
  const tag = languageOf(language)
  const ids = readdirSync(join(shipped, 'en'), { withFileTypes: true }).filter(entry => entry.isDirectory() && entry.name !== 'import' && entry.name !== 'world').flatMap(entry => listFiles(join(shipped, 'en', entry.name), `${entry.name}/`))
  return ids.sort().map(id => ({ id, kind: PROSE_PROMPTS.includes(id) ? 'prose' as const : 'rules' as const, carried: existsSync(join(directory, PROMPTS_FOLDER, tag, `${id}.md`)) }))
}

/** A prompt as sessions of the world get it: the world's own version, else the shipped text. */
export function readWorldPrompt(directory: string, language: string, id: string, shipped: string = shippedPromptsDirectory()): { id: string; language: string; carried: boolean; text: string } {
  const tag = languageOf(language)
  const own = fileOf(directory, tag, id, shipped)
  if (existsSync(own)) return { id, language: tag, carried: true, text: readFileSync(own, 'utf8') }
  const original = shippedFile(shipped, tag, id)
  return { id, language: tag, carried: false, text: original === undefined ? '' : readFileSync(original, 'utf8') }
}

/** @throws {Error} when the text is not acceptable for the prompt: see `promptProblem`. */
export async function writeWorldPrompt(directory: string, language: string, id: string, text: string, shipped: string = shippedPromptsDirectory()): Promise<void> {
  const tag = languageOf(language)
  const file = fileOf(directory, tag, id, shipped)
  const problem = promptProblem(tag, id, text, shipped)
  if (problem !== undefined) throw new Error(problem)
  await mkdir(dirname(file), { recursive: true })
  const temporary = `${file}.tmp`
  await writeFile(temporary, text.endsWith('\n') ? text : `${text}\n`)
  await rename(temporary, file)
}

/** Moves the world's own version into its `.trash`, so sessions use the shipped one again. @returns where it went. */
export async function deleteWorldPrompt(directory: string, language: string, id: string, shipped: string = shippedPromptsDirectory()): Promise<string> {
  const tag = languageOf(language)
  const file = fileOf(directory, tag, id, shipped)
  if (!existsSync(file)) throw new Error(`the world carries no prompt "${id}" in ${tag}`)
  const aside = join(directory, '.trash', PROMPTS_FOLDER, tag, `${id}.${Date.now()}.md`)
  await mkdir(dirname(aside), { recursive: true })
  await rename(file, aside)
  await rm(dirname(file), { recursive: false }).catch(() => undefined)
  return aside
}
