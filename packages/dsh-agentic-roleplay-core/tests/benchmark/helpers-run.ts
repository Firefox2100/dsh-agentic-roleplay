import type { ImportContext } from '../../src/host/import/run.ts'
import { shippedText } from '../../src/host/prompts/library.ts'

/** The live model the helpers of the product are pointed at: the benchmark replaces only the call to the model, so each helper runs its own code (briefs, checks, the way it writes its result). */
export const live: { context?: ImportContext } = {}

interface ChildTask { persona: string; prompt: string; result: unknown; beforeSubmit?: (value: unknown) => string | undefined; maxTokens?: number }

export const runChildMock = async (task: ChildTask): Promise<unknown> => {
  if (live.context === undefined) throw new Error('no live model is set')
  return live.context.run({ persona: task.persona, prompt: task.prompt, result: task.result, maxTokens: 8000, ...task.beforeSubmit === undefined ? {} : { check: task.beforeSubmit } } as never)
}

/** What `promptFor` gives an agent: the shipped text of the prompt, with the language named as the library does. */
export const promptForMock = (_agent: unknown, id: string, language: string, variables: Record<string, string | number> = {}): string =>
  shippedText(id, language, { language: language === 'zh' ? 'Chinese' : 'English', ...variables } as never)
