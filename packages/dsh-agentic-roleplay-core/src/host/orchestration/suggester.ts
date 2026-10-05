import type { Agent } from '@deepseek-ai/dsh-agent'
import type { ObjectJsonSchema } from '@deepseek-ai/dsh-tools'
import { runChild } from '../agents/child.ts'
import type { Suggester, SuggestionJob } from './boundaries.ts'
import { MAX_SUGGESTION, suggestionProblems, tidySuggestions } from './suggestions.ts'

/** Who writes the suggestions and how. The same for every run, so it is the part of each request the provider has cached. */
export const SUGGESTER_PERSONA = `You suggest what the player could do next in an interactive story. You are shown what the player has just read, and who they play. From that alone, and nothing else, you write short lines in the first person that the player might send as their next move ("Ask Clara about the ledger", "Slip out through the cellar").

Each line is different in kind from the others (say something, do something, leave, look closer), is possible in the scene as it stands, follows from what was just read, and is at most ${MAX_SUGGESTION} characters. Use only what the text says: never a fact, person, place or object it does not mention, and nothing the player's character could not know. Write in the language of the text. No numbering, no quotation marks, no explanation.`

const RESULT: ObjectJsonSchema = {
  type: 'object',
  properties: { options: { type: 'array', items: { type: 'string' }, description: 'The suggestions, as many as asked for.' } },
  required: ['options'],
  additionalProperties: false,
}

/** What the player read, as plain text. */
export function readingOf(job: SuggestionJob): string {
  return job.output.segments.map(segment => (segment.type === 'utterance' ? `${segment.name}: "${segment.text}"` : segment.text)).join('\n\n')
}

function promptOf(job: SuggestionJob): string {
  const player = job.store.cast().find(member => member.character.control === 'player')
  const place = player?.place?.location.name
  return [
    `Write exactly ${job.count} suggestion${job.count === 1 ? '' : 's'}.`,
    `The player plays ${player?.character.name ?? 'their character'}${place === undefined ? '' : `, who is at ${place}`}.`,
    '',
    'What the player has just read:',
    readingOf(job),
  ].join('\n')
}

/** Offers the player what to do next from what they just read, with an agent of its own, in the background of the story. */
export function suggestionWriter(deps: { agentOf: (chat: string) => Agent | undefined }): Suggester {
  return {
    async suggest(job, signal) {
      const parent = deps.agentOf(job.chat)
      if (parent === undefined) throw new Error(`no agent for chat ${job.chat}`)
      const result = await runChild<{ options: string[] }>({
        parent, signal, reasoningEffort: job.store.settings().reasoning.children,
        persona: SUGGESTER_PERSONA,
        prompt: promptOf(job),
        result: RESULT,
        beforeSubmit: (value) => {
          const problems = suggestionProblems(tidySuggestions((value as { options: string[] }).options), job.count)
          return problems.length === 0 ? undefined : `not acceptable: ${problems.join('; ')}`
        },
        maxCalls: 3,
      })
      return result.options
    },
  }
}
