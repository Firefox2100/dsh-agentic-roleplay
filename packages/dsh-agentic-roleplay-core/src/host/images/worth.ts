import type { Agent } from '@deepseek-ai/dsh-agent'
import type { ObjectJsonSchema } from '@deepseek-ai/dsh-tools'
import { runChild, type ChildSampling } from '../agents/child.ts'
import { promptFor } from '../prompts/access.ts'

export const WORTH_RESULT: ObjectJsonSchema = {
  type: 'object',
  properties: {
    reason: { type: 'string', description: 'One short sentence, written first: what happens in the passage and whether there is something to look at.' },
    worth: { type: 'boolean', description: 'Whether the moment deserves a picture.' },
  },
  required: ['reason', 'worth'],
  additionalProperties: false,
}

export interface WorthJob {
  parent: Agent
  signal: AbortSignal
  language: string
  /** What the player read of the turn. */
  moment: string
  sampling?: ChildSampling
  reasoningEffort?: string
}

/** Whether a moment of the story is worth a picture, as a helper with no tools judges it from what the player read. */
export async function worthAPicture(job: WorthJob): Promise<boolean> {
  const answer = await runChild<{ reason: string; worth: boolean }>({
    parent: job.parent,
    signal: job.signal,
    ...(job.reasoningEffort === undefined ? {} : { reasoningEffort: job.reasoningEffort }),
    ...(job.sampling === undefined ? {} : { sampling: job.sampling }),
    persona: promptFor(job.parent, 'roleplay/image-worth', job.language),
    prompt: job.moment,
    result: WORTH_RESULT,
    maxCalls: 2,
  })
  return answer.worth
}
