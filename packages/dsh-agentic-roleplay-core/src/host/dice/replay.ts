import { createHash } from 'node:crypto'
import { systemRoller, type Roller } from '@dsh-agentic-roleplay/state'

/** What a story does with its dice when it is taken back: roll them again, or let the same turn from the same place fall the same way. */
export type RollPolicy = 'reroll' | 'keep'

/**
 * Dice that fall the same way when a turn is played again from the same place. Each turn is given a seed (the story and the turn it follows); the n-th die of the turn is
 * drawn from the seed and n, so a regenerated or swapped turn meets the same numbers in the order it asks for them. The numbers are not tied to what is rolled for: a turn
 * that rolls other things in another order gets the same sequence. Stories that reroll use the system's randomness.
 */
export class RollReplay {
  private readonly turns = new Map<string, { seed: string; drawn: number }>()

  constructor(private readonly policy: (chat: string) => RollPolicy) {}

  /** A turn begins after the turn `parent` (or the start): its dice are drawn from this place. */
  begin(chat: string, session: string, parent: string | null): void {
    this.turns.set(chat, { seed: `${session}|${parent ?? 'start'}`, drawn: 0 })
  }

  forget(chat: string): void {
    this.turns.delete(chat)
  }

  /** The roller of a chat's turn. */
  roller(chat: string): Roller {
    if (this.policy(chat) !== 'keep') return systemRoller
    return (sides) => {
      const turn = this.turns.get(chat)
      if (turn === undefined) return systemRoller(sides)
      turn.drawn += 1
      const digest = createHash('sha256').update(`${turn.seed}|${turn.drawn}`).digest()
      return 1 + digest.readUIntBE(0, 6) % sides
    }
  }
}
