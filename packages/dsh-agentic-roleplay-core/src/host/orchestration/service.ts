import { Service, type Context } from '@deepseek-ai/cordis'
import type { Boundaries } from './boundaries.ts'
import { defaultBoundaries } from './defaults.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    roleplayOrchestration: RoleplayOrchestration
  }
}

/**
 * The extension points of a roleplay turn. Another plugin changes how the turn
 * behaves by replacing a boundary; the change applies from the next call on.
 */
export class RoleplayOrchestration extends Service {
  private current: Boundaries = defaultBoundaries()

  constructor(ctx: Context) {
    super(ctx, 'roleplayOrchestration')
  }

  get boundaries(): Boundaries {
    return this.current
  }

  /** @returns a function that puts the replaced boundaries back. */
  replace(replacements: Partial<Boundaries>): () => void {
    const previous = { ...this.current }
    this.current = { ...this.current, ...replacements }
    return () => {
      for (const key of Object.keys(replacements) as (keyof Boundaries)[]) {
        if (this.current[key] === replacements[key]) (this.current as Record<keyof Boundaries, unknown>)[key] = previous[key]
      }
    }
  }
}
