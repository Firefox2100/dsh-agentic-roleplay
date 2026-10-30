import { dueReflection, recordFailure } from '../memory/reflection.ts'
import { AUTHORING_NEEDS, type Boundaries, type TurnStore } from './boundaries.ts'
import type { ReflectionReason } from '../../shared/reflection.ts'
import { ReflectionRefusedError } from '../sessions/errors.ts'

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
  private readonly reflecting = new Set<string>()
  private readonly casting = new Set<string>()

  constructor(private readonly deps: AfterTurnDeps) {}

  start(owner: { chat: string; turn: number }, cancel: AbortSignal): void {
    this.consolidate(owner, cancel)
    this.strategize(owner, cancel)
    this.judge(owner, cancel)
    this.cast(owner, cancel)
    const reason = this.reflectionDue(owner)
    if (reason !== undefined) this.reflect(owner, reason, cancel)
  }

  /** Whether a reflection is running for the chat. */
  isReflecting(chat: string): boolean {
    return this.reflecting.has(chat)
  }

  /** Starts a reflection the player asked for, without waiting for it. @throws {ReflectionRefusedError} when one is already running. */
  reflectNow(owner: { chat: string; turn: number }, cancel: AbortSignal): void {
    if (this.deps.stores(owner.chat) === undefined) throw new Error(`no story for chat ${owner.chat}`)
    if (this.reflecting.has(owner.chat)) throw new ReflectionRefusedError('a reflection is already running')
    this.reflect(owner, 'manual', cancel)
  }

  private reflectionDue(owner: { chat: string; turn: number }): Exclude<ReflectionReason, 'manual'> | undefined {
    const store = this.deps.stores(owner.chat)
    return store === undefined || this.reflecting.has(owner.chat) ? undefined : dueReflection(store, owner.turn)
  }

  /** The characters sort what they have taken in into what they believe. The one failure that matters to the player, a pass they asked for, is kept for the settings tab. */
  private reflect(owner: { chat: string; turn: number }, reason: ReflectionReason, cancel: AbortSignal): void {
    const store = this.deps.stores(owner.chat)
    if (store === undefined) return
    this.reflecting.add(owner.chat)
    this.deps.track(owner.chat, this.deps.boundaries().reflector.reflect({ chat: owner.chat, turn: owner.turn, store, reason }, cancel)
      .then((report) => { if (report.characters.length > 0) this.deps.written(owner.chat) })
      .catch((error: unknown) => {
        if (cancel.aborted) return
        recordFailure(store.story, messageOf(error))
        this.deps.problem(`what the characters believe was not sorted: ${messageOf(error)}`)
      })
      .finally(() => { this.reflecting.delete(owner.chat) }))
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

  /** What a trigger asked the world author to make (a beat with `dispatch: author`) is made now, one request after the other: the game master is never asked, so it cannot ignore it. */
  private cast(owner: { chat: string; turn: number }, cancel: AbortSignal): void {
    const store = this.deps.stores(owner.chat)
    if (store === undefined || this.casting.has(owner.chat) || store.claimAuthorBeats === undefined || !store.settings().authoring.enabled) return
    const requests = store.claimAuthorBeats()
    if (requests.length === 0) return
    this.casting.add(owner.chat)
    this.deps.track(owner.chat, (async () => {
      for (const request of requests) {
        const need = AUTHORING_NEEDS.find(candidate => candidate === request.need)
        if (need === undefined) { this.deps.problem(`a trigger asked the world author for "${request.need}", which is not a reason to make something up`); continue }
        try {
          await this.deps.boundaries().author.create({ chat: owner.chat, turn: owner.turn, need, what: request.text, store }, cancel)
          this.deps.written(owner.chat)
        } catch (error) {
          if (!cancel.aborted) this.deps.problem(`the world author could not make what a trigger asked for: ${messageOf(error)}`)
        }
      }
    })().finally(() => { this.casting.delete(owner.chat) }))
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
