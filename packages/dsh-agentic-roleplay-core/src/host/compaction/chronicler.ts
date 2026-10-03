import type { Agent } from '@deepseek-ai/dsh-agent'
import type { SubagentRuntime } from '@deepseek-ai/dsh-subagent'
import type { ObjectJsonSchema } from '@deepseek-ai/dsh-tools'
import { CHRONICLER_PERSONA, type Chronicler } from './chronicle.ts'

const SUMMARY_SCHEMA: ObjectJsonSchema = {
  type: 'object',
  properties: { summary: { type: 'string', description: 'The passage, as plain prose.' } },
  required: ['summary'],
  additionalProperties: false,
}

/** Writes each passage with a one-shot sub-agent of the game master that has the chronicler's persona and no tools. */
export function subagentChronicler(subagents: Pick<SubagentRuntime, 'start'>, parent: Agent): Chronicler {
  return {
    async write({ task, material, words }, signal) {
      const run = await subagents.start('spawn', {
        parent,
        signal,
        label: 'Chronicler',
        prompt: [{ type: 'text', text: `${task}\n\nWrite at most ${words} words.\n\n${material}` }],
        persona: CHRONICLER_PERSONA,
        toolFilter: { allow: [] },
        outputSchema: SUMMARY_SCHEMA,
      })
      try {
        const result = await run.result
        if (result.stopReason !== 'completed') throw new Error(`the chronicler did not finish (${result.stopReason})`)
        const text = (result.structured as { summary?: unknown } | undefined)?.summary
        if (typeof text !== 'string' || text.trim() === '') throw new Error('the chronicler wrote nothing')
        return text
      } finally {
        await run.dispose()
      }
    },
  }
}
