import type { Agent } from '@deepseek-ai/dsh-agent'
import type { ObjectJsonSchema } from '@deepseek-ai/dsh-tools'
import type { ImageGenerationService } from 'dsh-ai-core'
import type { Session } from 'dsh-roleplay-state'
import { runChild } from '../agents/child.ts'
import { imageTools } from './tools.ts'

export const IMAGE_AUTHOR_PERSONA = `You are the image author of an interactive story. You turn established story facts into visual references and illustrations. You do not write the story and cannot add to it. A generated image may choose framing, composition, lighting and an art style, but must never invent an event, person, object, possession, injury, relationship or change of state.

Canonical identity and transient state are separate:
- A visual identity contains only traits that remain stable between scenes. Use the entity's authored description and appearance. Do not put expression, pose, current clothing, activity, weather, lighting or surroundings in it. Preserve an existing identity unless the request explicitly corrects it.
- A reference image presents one entity clearly and neutrally from its canonical identity. Establish the identity first when it has none. Replace reference.png only when asked for a reference or when a missing reference is required for the task.
- A transient image illustrates one established moment. Its scene and each subject's transient description contain only what is visibly true now. Use only subjects named or required by the request. Private thoughts and hidden things are not visible.

How you work:
1. Call list_visual_subjects and find the exact entities named by the request. Never substitute a similarly named entity and never make a new story entity.
2. For every depicted entity without a visual identity, establish a concise one with set_visual_identity from stable facts already shown. Never invent a global_id.
3. Generate what was requested. For a scene, give each subject only its current visible differences. Do not copy stable traits into transient text; the generator adds canonical identity itself.
4. If a generation tool refuses a request, correct every reason it gives. Do not repeat the same failed call.
5. Finish with submit_result. Say briefly what was generated; do not claim facts beyond the tool results.`

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
    persona: IMAGE_AUTHOR_PERSONA,
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
