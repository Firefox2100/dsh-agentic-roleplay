import { shippedText } from '../../src/host/prompts/library.ts'
import type { ChildJob, ImportContext } from '../../src/host/import/run.ts'

export interface Recorded { persona: string; prompt: string }

/** An import context that answers each job from a function and keeps what it was asked; the answers are checked as the real runner would. */
export function fakeContext(answer: (job: ChildJob<never>, asked: number) => unknown, limit = 3): ImportContext & { asked: Recorded[]; said: string[] } {
  const asked: Recorded[] = []
  const said: string[] = []
  return {
    asked,
    said,
    concurrency: limit,
    text: (id, variables) => shippedText(id, 'en', variables),
    say: (message) => { said.push(message) },
    run: async <T>(job: ChildJob<T>): Promise<T> => {
      asked.push({ persona: job.persona, prompt: job.prompt })
      const value = await answer(job as ChildJob<never>, asked.length) as T
      const refusal = job.check?.(value)
      if (refusal !== undefined) throw new Error(`refused: ${refusal}`)
      return value
    },
  }
}
