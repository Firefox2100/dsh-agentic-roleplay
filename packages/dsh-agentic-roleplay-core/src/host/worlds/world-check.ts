import { relative } from 'node:path'
import { InvalidWorldError } from '../sessions/errors.ts'
import { loadValidatedWorld, type CheckedWorld } from './validated-world.ts'

export interface WorldProblem {
  /** The file (or part of the world) the problem is in, relative to the world's folder. */
  where: string
  message: string
}

export interface WorldCheck {
  ok: boolean
  /** What the check says about the part of the world it stopped at. */
  summary?: string
  problems: WorldProblem[]
  /** How many more problems there were than are listed. */
  more: number
}

/** The most problems listed at once: the rest are named by their number. */
const LISTED = 40

/**
 * Whether a session could be started from the world as its files are now, and if not why, in the words a person or an assistant can act on. Starting a session runs the same
 * check; it names the problems of the first part of the world that has any (characters, factions, places, calendar, dice, items, lore, tracked values, triggers, plots), so
 * fixing those can show the next part's.
 */
export async function checkWorld(world: CheckedWorld): Promise<WorldCheck> {
  try {
    await loadValidatedWorld(world)
    return { ok: true, problems: [], more: 0 }
  } catch (error) {
    if (!(error instanceof InvalidWorldError)) throw error
    const problems = error.problems.map((problem): WorldProblem => ({ where: relative(world.directory, problem.path) || '(the world)', message: problem.message }))
    return { ok: false, summary: error.message, problems: problems.slice(0, LISTED), more: Math.max(0, problems.length - LISTED) }
  }
}
