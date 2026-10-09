import { promptFor } from '../prompts/access.ts'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { ObjectJsonSchema } from '@deepseek-ai/dsh-tools'
import type { ImageGenerationService } from 'dsh-ai-core'
import type { Session } from 'dsh-roleplay-state'
import { runChild, type ChildSampling } from '../agents/child.ts'
import { imageTools } from './tools.ts'


export interface ImageAuthorJob {
  parent: Agent
  signal: AbortSignal
  service: ImageGenerationService
  story: Session
  /** World or session folder that owns images/. */
  root: string
  turn: number
  timelineNode: string
  request: string
  purpose: 'reference' | 'transient'
  reasoningEffort?: string
  /** The language of the instructions the image author is given. */
  language: string
  sampling?: ChildSampling
  referenceMode?: 'text-only' | 'prefer-reference' | 'require-reference'
}

export interface ImageAuthorResult {
  summary: string
  images: string[]
}

const RESULT: ObjectJsonSchema = {
  type: 'object',
  properties: { summary: { type: 'string', description: 'A brief factual description of the images the tools generated.' } },
  required: ['summary'],
  additionalProperties: false,
}

/** One-shot image author with image tools on its own scope. It is not invoked by the roleplay loop yet. */
export async function runImageAuthor(job: ImageAuthorJob): Promise<ImageAuthorResult> {
  const generated: string[] = []
  const result = await runChild<{ summary: string }>({
    parent: job.parent,
    signal: job.signal,
    ...(job.reasoningEffort === undefined ? {} : { reasoningEffort: job.reasoningEffort }),
    ...(job.sampling === undefined ? {} : { sampling: job.sampling }),
    persona: promptFor(job.parent, 'roleplay/image-author', job.language),
    prompt: [
      `Create ${job.purpose === 'reference' ? 'a canonical reference image' : 'a transient story illustration'} as requested.`,
      `Request: ${job.request}`,
      `This is turn ${job.turn}, timeline node ${job.timelineNode}.`,
    ].join('\n'),
    tools: imageTools({ root: job.root, story: job.story, service: job.service, turn: job.turn, timelineNode: job.timelineNode, generated, signal: job.signal, ...(job.referenceMode === undefined ? {} : { referenceMode: job.referenceMode }) }),
    result: RESULT,
    beforeSubmit: () => generated.length === 0 ? 'you have not generated an image: use the appropriate generation tool before finishing' : undefined,
    maxCalls: 16,
  })
  return { summary: result.summary, images: [...generated] }
}
