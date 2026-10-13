import type { Boundaries, TurnStore } from './boundaries.ts'

/** Something made up that has waited this many turns is fitted into the world even if few are waiting. */
const STALE_AFTER_TURNS = 4

export interface AfterTurnDeps {
  boundaries: () => Boundaries
  stores: (chat: string) => TurnStore | undefined
  /** Keeps a job among what the chat has in flight, so that a rewind or a halt waits for it. */
  track: (chat: string, job: Promise<unknown>) => void
  problem: (message: string) => void
  /** Told when a job wrote to the story, so that what is new can be indexed. */
  written: (chat: string) => void
}

const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error))

/**
 * The background work that follows a delivered turn and writes to the story, none of which the turn waits for: fitting in what was made
 * up, the decisions of organisations, and the judging of the statements triggers wait on. Each runs one at a time per chat, within the
 * limits of the chat's settings, and a failure is reported and leaves the story as it was.
 */
export class AfterTurnJobs {
  private readonly consolidating = new Set<string>()
  private readonly strategizing = new Set<string>()
  private readonly judging = new Set<string>()

  constructor(private readonly deps: AfterTurnDeps) {}

  start(owner: { chat: string; turn: number }, cancel: AbortSignal): void {
    this.consolidate(owner, cancel)
    this.strategize(owner, cancel)
    this.judge(owner, cancel)
  }

  /** Fit what was made up into the rest of the world, when enough of it is waiting or some has waited long. */
  private consolidate(owner: { chat: string; turn: number }, cancel: AbortSignal): void {
    const store = this.deps.stores(owner.chat)
    if (store === undefined || this.consolidating.has(owner.chat)) return
    const { authoring } = store.settings()
    const pending = store.story.consolidation.pending()
    if (!authoring.enabled || pending.length === 0) return
    if (pending.length < authoring.consolidateAfter && !pending.some(item => owner.turn - item.createdTurn >= STALE_AFTER_TURNS)) return
    this.consolidating.add(owner.chat)
    this.deps.track(owner.chat, this.deps.boundaries().author.consolidate({ chat: owner.chat, turn: owner.turn, store }, cancel)
      .then(() => { this.deps.written(owner.chat) })
      .catch((error: unknown) => { if (!cancel.aborted) this.deps.problem(`made-up characters and places were not fitted into the world: ${messageOf(error)}`) })
      .finally(() => { this.consolidating.delete(owner.chat) }))
  }

  /** The organisations whose time has come decide what they do; the strategist holds the limits. */
  private strategize(owner: { chat: string; turn: number }, cancel: AbortSignal): void {
    const store = this.deps.stores(owner.chat)
    if (store === undefined || this.strategizing.has(owner.chat) || store.settings().factions.perTurn === 0) return
    this.strategizing.add(owner.chat)
    this.deps.track(owner.chat, this.deps.boundaries().strategist.strategize({ chat: owner.chat, turn: owner.turn, store }, cancel)
      .then((report) => { if (report.acted.length > 0) this.deps.written(owner.chat) })
      .catch((error: unknown) => { if (!cancel.aborted) this.deps.problem(`organisations were not asked what they do: ${messageOf(error)}`) })
      .finally(() => { this.strategizing.delete(owner.chat) }))
  }

  /** The statements that triggers wait on are judged; a trigger fires from the verdict at the next look. */
  private judge(owner: { chat: string; turn: number }, cancel: AbortSignal): void {
    const store = this.deps.stores(owner.chat)
    if (store === undefined || this.judging.has(owner.chat) || !store.settings().triggers.enabled || store.settings().triggers.judgedPerTurn === 0) return
    this.judging.add(owner.chat)
    this.deps.track(owner.chat, this.deps.boundaries().judge.judge({ chat: owner.chat, turn: owner.turn, store }, cancel)
      .catch((error: unknown) => { if (!cancel.aborted) this.deps.problem(`the statements triggers wait on were not judged: ${messageOf(error)}`) })
      .finally(() => { this.judging.delete(owner.chat) }))
  }
}
