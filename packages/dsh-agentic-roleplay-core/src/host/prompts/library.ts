import { copyFileSync, cpSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Service, type Context } from '@deepseek-ai/cordis'
import type { RoleplayRoot } from '../storage/roleplay-root.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    roleplayPrompts: PromptLibrary
  }
}

export const PROMPTS_FOLDER = 'prompts'
const SESSION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
export const FALLBACK_LANGUAGE = 'en'

const ID = /^[a-z0-9-]+(\/[a-z0-9-]+)*$/
const LANGUAGE = /^[a-z]{2,8}$/
const VARIABLE = /\$\{([A-Za-z]+)\}/g

export type PromptVariables = Readonly<Record<string, string | number>>

/** The folder of the prompts that ship with the package, found from this module so that it works from source and from the build. */
export function shippedPromptsDirectory(from: string = dirname(fileURLToPath(import.meta.url))): string {
  for (let directory = from; ; directory = dirname(directory)) {
    const candidate = join(directory, PROMPTS_FOLDER)
    if (existsSync(join(directory, 'package.json')) && existsSync(candidate)) return candidate
    if (dirname(directory) === directory) throw new Error('the prompts shipped with the package were not found')
  }
}

/** `zh-CN` and `ZH` are both `zh`; anything that is not a language tag is refused. */
export function languageOf(tag: string | undefined): string {
  const primary = (tag ?? FALLBACK_LANGUAGE).trim().toLowerCase().split(/[-_]/)[0] ?? ''
  if (!LANGUAGE.test(primary)) throw new Error(`"${tag}" is not a language`)
  return primary
}

function fill(id: string, text: string, variables: PromptVariables): string {
  // A line that holds only a variable given as empty text is dropped with it, so that an optional paragraph leaves no gap.
  const lines = text.trim().replace(/^\$\{([A-Za-z]+)\}[ \t]*(\r?\n|$)/gm, (match, name: string) => (variables[name] === '' ? '' : match))
  return lines.replace(VARIABLE, (_match, name: string) => {
    const value = variables[name]
    if (value === undefined) throw new Error(`prompt ${id} uses \${${name}}, which is not given a value (given: ${Object.keys(variables).join(', ') || 'none'})`)
    return String(value)
  })
}

/** A prompt as the package ships it, without a roleplay root: for code that has none, such as tests. */
export function shippedText(id: string, language = FALLBACK_LANGUAGE, variables: PromptVariables = {}): string {
  return fill(id, readFileSync(join(shippedPromptsDirectory(), language, `${id}.md`), 'utf8'), variables)
}

export function listFiles(directory: string, prefix = ''): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const name = `${prefix}${entry.name}`
    if (entry.isDirectory()) return listFiles(join(directory, entry.name), `${name}/`)
    return entry.name.endsWith('.md') ? [name.slice(0, -3)] : []
  })
}

/**
 * Every instruction the models are given is a file under `<root>/prompts/<language>/`, so that the person can edit them. The files
 * come from the package: one that is not there (never written, or deleted to restore it) is copied again when it is needed.
 */
export class PromptLibrary extends Service {
  constructor(ctx: Context, private readonly root: RoleplayRoot, private readonly shipped: string = shippedPromptsDirectory()) {
    super(ctx, 'roleplayPrompts')
  }

  get directory(): string {
    return join(this.root.path, PROMPTS_FOLDER)
  }

  /** The languages the package ships prompts in. */
  get languages(): string[] {
    return readdirSync(this.shipped, { withFileTypes: true }).filter(entry => entry.isDirectory()).map(entry => entry.name)
  }

  /** Writes every shipped prompt that is missing, so that they can be found and edited before they are first used. */
  bootstrap(): void {
    for (const language of this.languages) for (const id of listFiles(join(this.shipped, language))) this.file(id, language)
  }

  /**
   * The prompt `id` in the language (the primary subtag of a language tag), with `${name}` replaced by the variables.
   * A session may carry a file of its own under `prompts/<language>/` in its folder, which is used instead of the one in the root.
   */
  text(id: string, language: string | undefined, variables: PromptVariables = {}, session?: string): string {
    if (!ID.test(id)) throw new Error(`"${id}" is not a prompt id`)
    const tag = languageOf(language)
    const own = session === undefined ? undefined : this.override(id, tag, session)
    return fill(id, readFileSync(own ?? this.file(id, tag), 'utf8'), variables)
  }

  private override(id: string, language: string, session: string): string | undefined {
    if (!SESSION_ID.test(session)) throw new Error(`"${session}" is not a session id`)
    const found = join(this.root.path, 'sessions', session, PROMPTS_FOLDER, language, `${id}.md`)
    return this.usable(found, id) ? found : undefined
  }

  /** The path of the prompt in the root, copied from the package first when it is not there. A language the package has no prompt in uses the English one. */
  private file(id: string, language: string): string {
    const found = join(this.directory, language, `${id}.md`)
    if (this.usable(found, id)) return found
    const source = [language, FALLBACK_LANGUAGE].map(name => join(this.shipped, name, `${id}.md`)).find(path => existsSync(path))
    if (source === undefined) throw new Error(`there is no prompt ${id} in ${language} or ${FALLBACK_LANGUAGE}`)
    const target = source.startsWith(join(this.shipped, language)) ? found : join(this.directory, FALLBACK_LANGUAGE, `${id}.md`)
    if (!this.usable(target, id)) {
      mkdirSync(dirname(target), { recursive: true })
      copyFileSync(source, target)
    }
    return target
  }

  private usable(path: string, id: string): boolean {
    if (!existsSync(path)) return false
    if (statSync(path).size === 0 || readFileSync(path, 'utf8').trim() === '') throw new Error(`the prompt file ${path} (${id}) is empty; delete it to restore the original`)
    return true
  }
}

const names = (text: string): Set<string> => new Set([...text.matchAll(VARIABLE)].map(match => match[1] as string))

/** Why a text cannot be the prompt `id` in the language, or nothing when it can: it must be a prompt the package has, not empty, and use only the variables the prompt is given. */
export function promptProblem(language: string, id: string, text: string, shipped: string = shippedPromptsDirectory()): string | undefined {
  const original = ID.test(id) ? [language, FALLBACK_LANGUAGE].map(name => join(shipped, name, `${id}.md`)).find(path => existsSync(path)) : undefined
  if (original === undefined) return `there is no prompt "${id}"`
  if (text.trim() === '') return 'the prompt is empty'
  const allowed = names(readFileSync(original, 'utf8'))
  const unknown = [...names(text)].filter(name => !allowed.has(name))
  return unknown.length === 0 ? undefined : `uses ${unknown.map(name => `\${${name}}`).join(', ')}, which the prompt is not given (it is given: ${[...allowed].join(', ') || 'none'})`
}

/**
 * Copies the prompts a world carries (`prompts/<language>/<id>.md`) into a session folder, where they take the place of the ones in the root.
 * Each must be a prompt the package has, in a language it ships, not empty, and may use only the variables that prompt is given.
 * @returns the problems found, each with the file; nothing is copied when there are any.
 */
export function copyWorldPrompts(worldDirectory: string, target: string, shipped: string = shippedPromptsDirectory()): { path: string; message: string }[] {
  const source = join(worldDirectory, PROMPTS_FOLDER)
  if (!existsSync(source)) return []
  const problems: { path: string; message: string }[] = []
  const found: { from: string; to: string }[] = []
  for (const entry of readdirSync(source, { withFileTypes: true })) {
    const folder = join(source, entry.name)
    if (!entry.isDirectory() || !LANGUAGE.test(entry.name)) { problems.push({ path: folder, message: 'prompts are kept in a folder named by the language, such as en or zh' }); continue }
    for (const id of listFiles(folder)) {
      const from = join(folder, `${id}.md`)
      const message = promptProblem(entry.name, id, readFileSync(from, 'utf8'), shipped)
      if (message !== undefined) { problems.push({ path: from, message }); continue }
      found.push({ from, to: join(target, PROMPTS_FOLDER, entry.name, `${id}.md`) })
    }
  }
  if (problems.length > 0) return problems
  for (const { from, to } of found) { mkdirSync(dirname(to), { recursive: true }); copyFileSync(from, to) }
  return []
}

/** A branch plays with the prompts of the session it was cut from. */
export function inheritPrompts(from: string, to: string): void {
  if (existsSync(join(from, PROMPTS_FOLDER))) cpSync(join(from, PROMPTS_FOLDER), join(to, PROMPTS_FOLDER), { recursive: true })
}

/** The languages the package ships prompts in. */
export function shippedLanguages(shipped: string = shippedPromptsDirectory()): string[] {
  return readdirSync(shipped, { withFileTypes: true }).filter(entry => entry.isDirectory()).map(entry => entry.name)
}
