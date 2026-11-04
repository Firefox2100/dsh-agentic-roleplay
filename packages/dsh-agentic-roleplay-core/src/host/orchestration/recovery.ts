import { MASTER_RECOVERIES, RECOVERY_FLOOR, RECOVERY_SHRINK } from '../agents/limits.ts'
import { isUnfinishedCall } from '../agents/child.ts'

/**
 * Runs the game master's step again when the model's tool call could not be read, instead of ending the turn with nothing. The first try is the same request
 * (a model is not the same twice), later ones leave a smaller output, so a call that runs on is cut sooner. Past the last the failure stands.
 */
export class MasterRecovery {
  private readonly used = new Map<string, { turn: number; count: number }>()

  /** Whether the step is to be run again; counts it. */
  retry(chat: string, turn: number, failure: { message: string }): boolean {
    if (!isUnfinishedCall(new Error(failure.message))) return false
    const seen = this.used.get(chat)
    const count = seen?.turn === turn ? seen.count : 0
    if (count >= MASTER_RECOVERIES) return false
    this.used.set(chat, { turn, count: count + 1 })
    return true
  }

  /** The output cap of the chat's next request: as set until a step was run again, then shrinking with each recovery. */
  budget(chat: string, cap: number): number {
    const count = this.used.get(chat)?.count ?? 0
    return count < 2 ? cap : Math.max(Math.min(cap, RECOVERY_FLOOR), Math.floor(cap * RECOVERY_SHRINK ** (count - 1)))
  }

  /** A turn that ended starts the next from the full cap. */
  clear(chat: string): void {
    this.used.delete(chat)
  }
}
