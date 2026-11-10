import type { ImportContext, RunJob } from '../../src/host/import/run.ts'
import { shippedText } from '../../src/host/prompts/library.ts'
import type { Language } from './language.ts'
import { replayer, type TraceLine } from './trace.ts'

/**
 * An import context whose model is a recorded trace: every job gets the answer it got in the live run, and the job's own check still judges it, as in the product. The code under
 * test (the importer, the prompts it reads, the checks) runs for real; only the model is the recording, so a failure seen once can be worked on without the model and a change of code
 * can be tried against what the model really said.
 */
export function replayContext(events: readonly TraceLine[], language: Language): ImportContext {
  const answer = replayer(events)
  const run: RunJob = (async (job: { persona: string; prompt: string; result: unknown; check?: (value: unknown) => string | undefined }) => {
    const value = answer(job.persona, job.prompt, job.result)
    const refusal = job.check?.(value)
    if (refusal !== undefined) throw new Error(`the recorded answer is refused now: ${refusal}`)
    return value
  }) as never
  return { run, concurrency: 1, text: (id, variables) => shippedText(id, language, variables), language, say: () => undefined }
}

/** The structured-reply model of the tracked-value benchmark, answered from a trace. */
export function replayStructured(events: readonly TraceLine[]): (request: { persona: string; prompt: string; result: unknown }) => Promise<unknown> {
  const answer = replayer(events)
  return ({ persona, prompt, result }) => Promise.resolve(answer(persona, prompt, result))
}
