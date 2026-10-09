import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync } from 'node:fs'
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
  return text.trim().replace(VARIABLE, (_match, name: string) => {
    const value = variables[name]
    if (value === undefined) throw new Error(`prompt ${id} uses \${${name}}, which is not given a value (given: ${Object.keys(variables).join(', ') || 'none'})`)
    return String(value)
  })
}

/** A prompt as the package ships it, without a roleplay root: for code that has none, such as tests. */
export function shippedText(id: string, language = FALLBACK_LANGUAGE, variables: PromptVariables = {}): string {
  return fill(id, readFileSync(join(shippedPromptsDirectory(), language, `${id}.md`), 'utf8'), variables)
}

function listFiles(directory: string, prefix = ''): string[] {
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

  /** The prompt `id` in the language (the primary subtag of a language tag), with `${name}` replaced by the variables. */
  text(id: string, language: string | undefined, variables: PromptVariables = {}): string {
    if (!ID.test(id)) throw new Error(`"${id}" is not a prompt id`)
    return fill(id, readFileSync(this.file(id, languageOf(language)), 'utf8'), variables)
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
