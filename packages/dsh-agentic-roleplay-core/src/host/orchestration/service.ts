import { Service, type Context } from '@deepseek-ai/cordis'
import type { Boundaries } from './boundaries.ts'
import { defaultBoundaries } from './defaults.ts'
import type { Timelines } from '../timeline/service.ts'
import type { ImageJobs } from '../images/jobs.ts'

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

  /** Resolves once the records of a chat's recorded rounds are written (or have failed): the writing goes on behind the story, so what needs them waits here. */
  settle: (chat: string) => Promise<void> = () => Promise.resolve()

  /** Stops everything a chat has in flight in the background and waits for it; there while the orchestration is. */
  halt: (chat: string) => Promise<void> = () => Promise.resolve()

  /** Starts a reflection of a chat's characters on what they have taken in, in the background; there while the orchestration is. */
  reflect: (chat: string) => Promise<void> = () => Promise.reject(new Error('the orchestration is not running'))

  /** Whether a reflection of the chat is running; there while the orchestration is. */
  reflecting: (chat: string) => boolean = () => false

  /** What the story's turns are and taking the story back to one; there while the orchestration is. */
  timelines: Timelines | undefined

  /** Background scene illustration jobs; there while the orchestration is mounted. */
  images: ImageJobs | undefined

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
