import { shippedText } from '../../src/host/prompts/library.ts'
import type { ImportContext, RunJob } from '../../src/host/import/run.ts'
import type { Judging } from '../../src/host/checks/tools.ts'

/** A model for judged checks that answers each job from `answer`, applying the job's own check the way the real runner does (a refused answer is an error here). */
export function fakeModel(answer: (job: Parameters<RunJob>[0]) => unknown, extra: Partial<ImportContext> = {}): ImportContext {
  const run: RunJob = (async (job: { check?: (value: unknown) => string | undefined }) => {
    const value = answer(job as never)
    const problem = job.check?.(value)
    if (problem !== undefined) throw new Error(`refused: ${problem}`)
    return value
  }) as never
  return { run, concurrency: 2, text: (id, variables) => shippedText(id, 'en', variables), say: () => undefined, language: 'en', ...extra }
}

export const judging = (): Judging => ({
  settings: () => ({ maxUploadBytes: 1, concurrency: 1, reasoning: '', model: '', maxTokens: 16000, variablesPerRequest: 25, structured: 'tool' as const, temperature: 0.2, timeoutMinutes: 0, decisions: 'llm' as const, confidence: 0.7 }),
  prompting: { prompts: () => ({ text: (id: string, language: string | undefined, variables?: Record<string, string | number>) => shippedText(id, language ?? 'en', variables) }), languages: () => ({ get: () => 'en' }) } as never,
})
