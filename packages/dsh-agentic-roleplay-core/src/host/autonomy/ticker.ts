import type { ChatSettings } from '../../shared/settings.ts'

export interface TickerDeps {
  /** Every story, with whether it was put away. */
  sessions(): { id: string; name: string; archived: boolean }[]
  settings(id: string): ChatSettings
  /** Makes sure the story's chat is loaded, so that its characters can be asked. */
  ensure(id: string, name: string): Promise<unknown>
  tick(chat: string, signal: AbortSignal): Promise<{ outcome: string; moved: number; message?: string }>
  problem(message: string): void
}

/**
 * Looks at the stories that switched on going on while their player is away, one after the other and one at a time: a story that did not is never touched, and
 * a story that cannot be looked at is reported and left for the next time.
 */
export class AutonomyTicker {
  private running = false

  constructor(private readonly deps: TickerDeps) {}

  /** @returns how many stories were looked at. */
  async run(signal: AbortSignal): Promise<number> {
    if (this.running) return 0
    this.running = true
    let looked = 0
    try {
      for (const session of this.deps.sessions()) {
        if (signal.aborted) break
        if (session.archived) continue
        let on: boolean
        try {
          const { autonomy, clock } = this.deps.settings(session.id)
          on = autonomy.enabled && clock.mode === 'real'
        } catch (error) {
          this.deps.problem(`the settings of "${session.name}" could not be read: ${error instanceof Error ? error.message : String(error)}`)
          continue
        }
        if (!on) continue
        try {
          await this.deps.ensure(session.id, session.name)
          await this.deps.tick(`session-${session.id}`, signal)
          looked += 1
        } catch (error) {
          if (!signal.aborted) this.deps.problem(`"${session.name}" could not be looked at while its player is away: ${error instanceof Error ? error.message : String(error)}`)
        }
      }
    } finally {
      this.running = false
    }
    return looked
  }
}
