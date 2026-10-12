import { promptFor } from '../prompts/access.ts'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { ObjectJsonSchema } from '@deepseek-ai/dsh-tools'
import type { ImageGenerationService } from '@dsh-ai-providers/core'
import type { Session } from '@dsh-agentic-roleplay/state'
import { runChild, type ChildSampling } from '../agents/child.ts'
import { imageTools } from './tools.ts'
import { canReadImages, type ImageAttachments } from './interpreter.ts'
import type { Embedder } from '../memory/embedding-index.ts'


export interface ImagePresenterJob {
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
  /** Whether it may look in the library first: the picture was not asked for by the person, so a fitting one that exists is better than a new one. */
  reuse?: boolean
  /** Lets the agent be shown the pictures a search finds, when its model can see them. */
  attachments?: ImageAttachments
  /** Searching by meaning as well as words, when there is an embedding service. */
  embedder?: Embedder
  reasoningEffort?: string
  /** The language of the instructions the image author is given. */
  language: string
  sampling?: ChildSampling
  referenceMode?: 'text-only' | 'prefer-reference' | 'require-reference'
}

export interface ImagePresenterResult {
  summary: string
  images: string[]
}

const RESULT: ObjectJsonSchema = {
  type: 'object',
  properties: { summary: { type: 'string', description: 'A brief factual description of the images the tools generated.' } },
  required: ['summary'],
  additionalProperties: false,
}

/**
 * One-shot image presentation agent, with its tools on its own scope. Asked for a picture of a moment, it either shows an image the session
 * already has (when `reuse` is on and the picture is not asked for outright) or has a new one generated.
 */
export async function runImagePresenter(job: ImagePresenterJob): Promise<ImagePresenterResult> {
  const generated: string[] = []
  // The agent judges a candidate by looking at it when its model can; otherwise by its description.
  const sees = job.reuse === true && job.attachments !== undefined && await canReadImages(job.parent, '', job.signal)
  const result = await runChild<{ summary: string }>({
    parent: job.parent,
    signal: job.signal,
    ...(job.reasoningEffort === undefined ? {} : { reasoningEffort: job.reasoningEffort }),
    ...(job.sampling === undefined ? {} : { sampling: job.sampling }),
    persona: promptFor(job.parent, 'roleplay/image-presenter', job.language, { reuse: job.reuse === true ? promptFor(job.parent, 'roleplay/image-reuse', job.language) : '' }),
    prompt: [
      job.reuse === true ? 'Find or create the picture for this moment of the story.' : `Create ${job.purpose === 'reference' ? 'a canonical reference image' : 'a transient story illustration'} as requested.`,
      `Request: ${job.request}`,
      `This is turn ${job.turn}, timeline node ${job.timelineNode}.`,
    ].join('\n'),
    tools: imageTools({ root: job.root, story: job.story, service: job.service, turn: job.turn, timelineNode: job.timelineNode, generated, signal: job.signal, ...(job.reuse === true ? { library: true, sees, ...(job.attachments === undefined ? {} : { attachments: job.attachments }), ...(job.embedder === undefined ? {} : { embedder: job.embedder }) } : {}), ...(job.referenceMode === undefined ? {} : { referenceMode: job.referenceMode }) }),
    result: RESULT,
    beforeSubmit: () => generated.length === 0 ? 'you have not shown or generated an image: use the appropriate tool before finishing' : undefined,
    maxCalls: 16,
  })
  return { summary: result.summary, images: [...generated] }
}
