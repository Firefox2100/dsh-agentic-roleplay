/**
 * Every limit that keeps an agent from running away, in one place: how many calls, repeats, refusals and steps a helper gets, how long a stopped one has to wind down, and how often
 * a game master or an authoring assistant may repeat itself in a turn before it is told, and then stopped.
 */

// What one helper (`runChild`) may do.
/** Calls a child may make before it is given up; a child that keeps going is not converging. */
export const DEFAULT_MAX_CALLS = 40

/** A child that stops without a result is told to submit this many times before it is given up. */
export const MAX_REMINDERS = 2
/** A child that goes on calling tools this many times past its budget, in spite of being told to submit, is stopped: it would otherwise loop for as long as the model keeps at it. */
export const MAX_OVERRUN = 5
/** Steps a child gets to submit once its other tools are withdrawn: a model that keeps calling tools that are gone is stopped. */
export const STEPS_AFTER_RETIRE = 3
/** The most model steps a child may take past its call budget in all (calls the harness refuses before they run, such as a result that does not fit its schema, are not counted as calls). */
export const STEPS_PAST_BUDGET = 20

/** The same call, with the same arguments, that failed before is refused after this many repeats, and the child is stopped at twice that: the model is not reading the reasons it was given. */
export const REPEATS_TOLD = 1
export const REPEATS_STOPPED = 4
/** A result that is refused this many times is not going to be fixed by asking again: the child is stopped and the caller decides what to do without it. */
export const MAX_RESULT_REFUSALS = 5
/**
 * How long a child that was stopped has to wind down. Found live twice: a stopped child's activation never settled and the caller waited for ever (an import stood still for
 * minutes, a game master's turn never ended), so what the stop decided is not waited on past this.
 */
export const STOP_GRACE_MS = 15_000

// What an agent that is not a helper may do in one turn.

/** Times an authoring assistant is steered back in one turn after a reply was cut off: a model that rambles again after being told not to will not stop because it is told once more. */
export const AUTHORING_NUDGES = 6
/** How often an authoring assistant may make exactly the same call in a turn before it is refused: past this it is looping (found live: one create-and-list pair 47 times in one review), not working. */
export const AUTHORING_SAME_CALL = 3
/** The same, for the game master: a refused resolution is mended and sent again, so a few repeats are work and many are a loop. */
export const MASTER_SAME_CALL = 4
/** Refused repeats after which the turn is ended instead of being refused again: the model is not reading the refusals (found live: one call 442 times in a review turn). */
export const REFUSALS_BEFORE_STOP = 5
