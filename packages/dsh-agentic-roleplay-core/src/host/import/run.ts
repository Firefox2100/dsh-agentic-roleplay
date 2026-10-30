import type { ObjectJsonSchema } from '@deepseek-ai/dsh-tools'
import { languageOf, translator, type Translate } from 'dsh-roleplay-model'
import { trimCharacters } from '../../shared/text.ts'

/** One narrow job for one model call: who it is, what is asked, and the shape of the answer. A refused answer is tried again with the reason. */
export interface ChildJob<T> {
  persona: string
  prompt: string
  result: ObjectJsonSchema
  /** The most the answer can need, in tokens; a model that writes on past it is cut off sooner than the settings' limit. */
  maxTokens?: number
  /** Why the answer cannot be used, or nothing when it can. */
  check?: (value: T) => string | undefined
}

/** Runs a job and returns its checked answer. It throws when the model never gives one. */
export type RunJob = <T>(job: ChildJob<T>) => Promise<T>

export type TextOf = (id: string, variables?: Record<string, string | number>) => string

/** What the stages of an import are given: a way to run jobs, how many may run at once, and where to say what is going on. */
export interface ImportContext {
  run: RunJob
  concurrency: number
  /** There is no model: the stages that only a model can do are skipped without a note. */
  noModel?: boolean
  /** How many tracked values one request is asked to declare. */
  variablesPerRequest?: number
  /** An instruction text of the import, in the language of the person who started it. */
  text: TextOf
  /** The language of the person who started it, as the text of the prompts is chosen; the labels of what each job is shown are in it too. */
  language?: string
  say: (message: string) => void
  /** Whether the run was stopped (the chat was cancelled or the server went down): what the jobs left behind is then not a result. */
  cancelled?: () => boolean
  /** Asks the decision model, when the person chose to use one for imports, a yes-or-no question for each key about one piece; the answers are probabilities of yes. */
  decide?: (state: Record<string, unknown>, asks: readonly { key: string; instructions: string }[]) => Promise<Map<string, number>>
  /** How sure the decision model must be for its answer to be taken (0 to 1). */
  confidence?: number
}

/** The labels of a job's prompt, in the language of the import. */
export const trOf = (ctx: Pick<ImportContext, 'language'>): Translate => translator(languageOf(ctx.language))

/** Runs `work` on every item, at most `limit` at a time, and returns the results in the order of the items. */
export async function mapLimit<T, R>(items: readonly T[], limit: number, work: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length)
  let next = 0
  const lane = async (): Promise<void> => {
    while (next < items.length) {
      const at = next
      next += 1
      results[at] = await work(items[at]!, at)
    }
  }
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, lane))
  return results
}

/** A name as it is compared: letters and digits of any script, folded, without spaces and punctuation. */
export function norm(name: string): string {
  return name.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '')
}

/** A file-safe key from a name: the letters and digits of any script joined by hyphens; `fallback` when nothing is left. */
/** An id made of the letters and digits of a name, in whatever script it is written; a name with none gets the fallback. */
export function slug(name: string, fallback: string): string {
  const key = trimCharacters(trimCharacters(name.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '-'), '-').slice(0, 60), '-', 'end')
  return key === '' ? fallback : key
}

/** `base`, or `base-2`, `base-3` … the first that `taken` does not hold; the key is added to it. */
export function uniqueKey(base: string, taken: Set<string>): string {
  let key = base
  for (let n = 2; taken.has(key); n += 1) key = `${base}-${n}`
  taken.add(key)
  return key
}
