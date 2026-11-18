import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { Service, type Context } from '@deepseek-ai/cordis'
import { FALLBACK_LANGUAGE, languageOf } from '../prompts/library.ts'
import { DEFAULT_KEEP_RESULT_TURNS, DEFAULT_TOOL_HIDING, isKeepResultTurns, isToolHiding, type AuthoringSettings, type ToolHiding } from '../../shared/authoring-settings.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    roleplayAuthoringLanguages: AuthoringLanguages
  }
}

interface Stored { language?: unknown; generation?: unknown; toolHiding?: unknown; keepResultTurns?: unknown }

/**
 * What the authoring assistant keeps of a world: the language the person was using when they last worked on it, which the assistant's instructions follow, which
 * conversation of the world is the current one (a deleted one is never reused), and the settings of its conversations. Kept beside the worlds, not in them, so that a world folder holds only the world.
 */
export class AuthoringLanguages extends Service {
  constructor(ctx: Context, private readonly worldsDirectory: () => string) {
    super(ctx, 'roleplayAuthoringLanguages')
  }

  get(worldId: string): string {
    const value = this.read(worldId).language
    return typeof value === 'string' ? languageOf(value) : FALLBACK_LANGUAGE
  }

  set(worldId: string, language: string | undefined): void {
    if (language === undefined) return
    this.write(worldId, { ...this.read(worldId), language: languageOf(language) })
  }

  /** The conversation of the world that is current, counted from 1. */
  generation(worldId: string): number {
    const value = this.read(worldId).generation
    return typeof value === 'number' && Number.isInteger(value) && value >= 1 ? value : 1
  }

  /** Moves on to a new conversation of the world, once the current one is deleted. @returns the new generation. */
  advance(worldId: string): number {
    const next = this.generation(worldId) + 1
    this.write(worldId, { ...this.read(worldId), generation: next })
    return next
  }

  /** How the world's conversations leave out tools they cannot use yet; read at each step, so a change applies to the next request. */
  toolHiding(worldId: string): ToolHiding {
    const value = this.read(worldId).toolHiding
    return isToolHiding(value) ? value : DEFAULT_TOOL_HIDING
  }

  /** How many turns keep the results of their tool calls in the conversation; 0 keeps all. */
  keepResultTurns(worldId: string): number {
    const value = this.read(worldId).keepResultTurns
    return isKeepResultTurns(value) ? value : DEFAULT_KEEP_RESULT_TURNS
  }

  settings(worldId: string): AuthoringSettings {
    return { toolHiding: this.toolHiding(worldId), keepResultTurns: this.keepResultTurns(worldId) }
  }

  change(worldId: string, settings: Partial<AuthoringSettings>): AuthoringSettings {
    this.write(worldId, { ...this.read(worldId), ...(settings.toolHiding === undefined ? {} : { toolHiding: settings.toolHiding }), ...(settings.keepResultTurns === undefined ? {} : { keepResultTurns: settings.keepResultTurns }) })
    return this.settings(worldId)
  }

  private read(worldId: string): Stored {
    try {
      return JSON.parse(readFileSync(this.file(worldId), 'utf8')) as Stored
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {}
      throw error
    }
  }

  private write(worldId: string, value: Stored): void {
    const file = this.file(worldId)
    mkdirSync(join(file, '..'), { recursive: true })
    const temporary = `${file}.tmp`
    writeFileSync(temporary, `${JSON.stringify(value)}\n`)
    renameSync(temporary, file)
  }

  private file(worldId: string): string {
    return join(this.worldsDirectory(), '.authoring', `${encodeURIComponent(worldId)}.json`)
  }
}
