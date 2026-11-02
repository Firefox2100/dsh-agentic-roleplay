import type { PromptPart } from './trace.ts'

/** One request to a model, as the chat's log recorded it: what it carried, how long it took to answer and how it ended. */
export interface RequestStat {
  /** The step of the agent's turn it was made for. */
  step: number
  /** Everything the prompt held, cached input included; absent when the service reported no usage. */
  prompt?: number
  /** The part of the prompt the service read from its cache; absent when the service does not say, which is not the same as none. */
  cached?: number
  output?: number
  /** From the request to the first thing the model sent back, in milliseconds: with a prompt of the same size, a short wait is the sign of a cache hit when the service does not report one. */
  waitMs?: number
  /** From the request to the end of the answer. */
  ms?: number
  /** How it stopped: `stop`, `tool-calls`, `max-tokens` (the output limit cut it off) or `error`. */
  stop: string
  /** What the prompt was made of, estimated from the text of the log; absent for requests made before it was kept. */
  parts?: PromptPart[]
}

/** The most requests kept for one run or turn: the first ones. */
export const MAX_REQUESTS = 40
