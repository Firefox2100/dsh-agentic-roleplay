import type { Agent } from '@deepseek-ai/dsh-agent'
import type { ObjectJsonSchema } from '@deepseek-ai/dsh-tools'
import { tokensOf, FIELD_TOKENS } from '../agents/budget.ts'
import { childModel, childSampling, runChild } from '../agents/child.ts'
import { promptFor } from '../prompts/access.ts'
import type { ChatSettings } from '../../shared/settings.ts'
import type { Chronicler } from './chronicle.ts'

const SUMMARY_SCHEMA: ObjectJsonSchema = {
  type: 'object',
  properties: { summary: { type: 'string', description: 'The passage, as plain prose.' } },
  required: ['summary'],
  additionalProperties: false,
}

/** Writes each passage with a one-shot child of the game master that has the chronicler's persona and no tools of its own. */
export function childChronicler(parent: Agent, settings: ChatSettings): Chronicler {
  const language = settings.prompts.language
  return {
    async write({ task, material, words }, signal) {
      const estimate = tokensOf(words * (language.toLowerCase().startsWith('zh') ? 1 : 6), language) + FIELD_TOKENS
      const result = await runChild<{ summary: string }>({
        parent, signal, reasoningEffort: settings.reasoning.children, sampling: childSampling(settings, 'records', estimate), ...childModel(settings, 'records'),
        persona: promptFor(parent, 'roleplay/chronicler', language),
        prompt: `${task}\n\nWrite at most ${words} words.\n\n${material}`,
        result: SUMMARY_SCHEMA,
        beforeSubmit: value => ((value as { summary?: unknown }).summary as string | undefined)?.trim() === '' ? 'the passage is empty: write it' : undefined,
        maxCalls: 3,
      })
      return result.summary
    },
  }
}
