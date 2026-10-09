import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { Service, type Context } from '@deepseek-ai/cordis'
import { FALLBACK_LANGUAGE, languageOf } from '../prompts/library.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    roleplayAuthoringLanguages: AuthoringLanguages
  }
}

/**
 * The language the person was using when they last worked on a world with the authoring assistant. The assistant's instructions
 * follow it. Kept beside the worlds, not in them, so that a world folder holds only the world.
 */
export class AuthoringLanguages extends Service {
  constructor(ctx: Context, private readonly worldsDirectory: () => string) {
    super(ctx, 'roleplayAuthoringLanguages')
  }

  get(worldId: string): string {
    try {
      const value = (JSON.parse(readFileSync(this.file(worldId), 'utf8')) as { language?: unknown }).language
      return typeof value === 'string' ? languageOf(value) : FALLBACK_LANGUAGE
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return FALLBACK_LANGUAGE
      throw error
    }
  }

  set(worldId: string, language: string | undefined): void {
    if (language === undefined) return
    const file = this.file(worldId)
    mkdirSync(join(file, '..'), { recursive: true })
    const temporary = `${file}.tmp`
    writeFileSync(temporary, `${JSON.stringify({ language: languageOf(language) })}\n`)
    renameSync(temporary, file)
  }

  private file(worldId: string): string {
    return join(this.worldsDirectory(), '.authoring', `${encodeURIComponent(worldId)}.json`)
  }
}
