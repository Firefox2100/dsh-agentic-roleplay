import { readFile } from 'node:fs/promises'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { ImageBlock } from '@deepseek-ai/dsh-llm'
import type { ObjectJsonSchema } from '@deepseek-ai/dsh-tools'
import type { SessionStore } from '@dsh-agentic-roleplay/state'
import type { GalleryImage } from '../../shared/gallery.ts'
import { runChild, type ChildSampling } from '../agents/child.ts'
import { promptFor } from '../prompts/access.ts'
import { galleryFile, updateImage } from './gallery.ts'
import { storySubjects } from './tools.ts'

/** The attachment service of DSH, which stores an image durably and hands back what a model message cites. */
export interface ImageAttachments {
  saveImage(input: { data: Uint8Array; mediaType: 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif'; name?: string }): Promise<ImageBlock['attachment']>
}

export interface InterpretJob {
  parent: Agent
  signal: AbortSignal
  attachments: ImageAttachments
  story: Omit<SessionStore, 'snapshotTo' | 'close'>
  sessionFolder: string
  /** Under `images/`. */
  path: string
  language: string
  /** The model to describe with, as `provider/model`; the parent's own when empty. */
  model?: string
  /** A model that only captions pictures, as `provider/model`: it looks at the picture and the chat's model turns its words into the description, tags and subjects. */
  captioner?: string
  sampling?: ChildSampling
  reasoningEffort?: string
}

const RESULT: ObjectJsonSchema = {
  type: 'object',
  properties: {
    description: { type: 'string', description: 'What the picture shows, in two to four plain sentences that stand on their own: who or what, where, what is happening, the mood and the look.' },
    tags: { type: 'array', items: { type: 'string' }, description: 'Short search words: kinds of place, objects, colours, mood, time of day, style.' },
    subjects: { type: 'array', items: { type: 'object', properties: { kind: { type: 'string', enum: ['character', 'location', 'item'] }, name: { type: 'string' } }, required: ['kind', 'name'], additionalProperties: false }, description: 'The characters, places and things of the story that the picture clearly shows, by the names in the list you were given. Leave it empty when none is clearly there.' },
  },
  required: ['description', 'tags', 'subjects'],
  additionalProperties: false,
}

/**
 * Has a model that can read images say what a picture the person brought shows, and writes the answer into the file, so that the picture can be found and used
 * like one the story made. A model that cannot read images fails here, and the picture stays as it was.
 * @throws {Error} when the picture cannot be read or described.
 */
/** A model given as `provider/model`, or the one the chat runs on when `chosen` is empty. */
function modelOf(parent: Agent, chosen: string): { provider: string; model: string } {
  const named = chosen.trim()
  const config = parent.session.requestHeader()?.config
  const [provider, ...rest] = named === '' ? [config?.provider, config?.model] : named.split('/')
  const model = named === '' ? config?.model : rest.join('/')
  if (provider === undefined || provider === '' || model === undefined || model === '') throw new Error(named === '' ? 'this chat has no model selected' : `"${named}" is not provider/model`)
  return { provider, model }
}

/** Whether the model says it can read images. A model that cannot is told the picture is missing, and describes what it imagines. */
export async function canReadImages(parent: Agent, chosen: string, signal: AbortSignal): Promise<boolean> {
  try {
    const { provider, model } = modelOf(parent, chosen)
    return (await parent.ctx.llm.resolveModelInfo(provider, model, signal)).inputModalities?.includes('image') === true
  } catch { return false }
}

async function readerOf(job: InterpretJob, chosen: string): Promise<{ provider: string; model: string }> {
  const found = modelOf(job.parent, chosen)
  if (!await canReadImages(job.parent, chosen, job.signal)) throw new Error(`${found.provider}/${found.model} is not declared able to read images: choose a vision model in the chat settings (images.interpreterModel or images.captioner), or mark the model as vision in the provider`)
  return found
}

/** What a model that only writes captions says about the picture: plain text, with no tools to answer through. */
async function caption(job: InterpretJob, captioner: { provider: string; model: string }, attachment: ImageBlock['attachment']): Promise<string> {
  let text = ''
  const messages = [{ role: 'user', content: [{ type: 'text', text: 'Describe this picture in detail: who or what is in it, where, what is happening, the mood, the colours and the style. Describe only what you see.' }, { type: 'image', attachment }] }] as never
  for await (const chunk of job.parent.ctx.llm.stream({ provider: captioner.provider, model: captioner.model, messages, maxTokens: 600, temperature: 0.2, signal: job.signal })) {
    if (chunk.type === 'text-delta') text += chunk.text
  }
  if (text.trim() === '') throw new Error(`${captioner.provider}/${captioner.model} wrote no caption`)
  return text.trim()
}

export async function interpretImage(job: InterpretJob): Promise<GalleryImage> {
  const captioner = job.captioner?.trim() ?? ''
  // A captioner looks at the picture and the chat's model structures what it said; otherwise one model does both.
  const reader = captioner === '' ? await readerOf(job, job.model ?? '') : await readerOf(job, captioner)
  const { file, mediaType } = await galleryFile(job.sessionFolder, job.path)
  const known = storySubjects(job.story).filter(subject => !subject.hidden)
  const attachment = await job.attachments.saveImage({ data: new Uint8Array(await readFile(file)), mediaType: mediaType as 'image/png', name: job.path.split('/').at(-1) ?? 'image' })
  const captionText = captioner === '' ? undefined : await caption(job, reader, attachment)
  const answer = await runChild<{ description: string; tags: string[]; subjects: { kind: 'character' | 'location' | 'item'; name: string }[] }>({
    parent: job.parent,
    signal: job.signal,
    ...(captionText === undefined ? { model: reader } : {}),
    ...(job.reasoningEffort === undefined ? {} : { reasoningEffort: job.reasoningEffort }),
    ...(job.sampling === undefined ? {} : { sampling: job.sampling }),
    persona: promptFor(job.parent, 'roleplay/image-interpreter', job.language),
    prompt: `The characters, places and things of this story, by name:\n${known.map(subject => `- ${subject.name} (${subject.kind})`).join('\n') || '(none)'}\n\n${captionText === undefined ? 'Describe the picture that follows.' : `Another model looked at the picture and wrote this caption. Turn it into the description, tags and subjects, adding nothing it does not say:\n\n${captionText}`}`,
    ...(captionText === undefined ? { images: [attachment] } : {}),
    result: RESULT,
    beforeSubmit: (value) => {
      const result = value as { description: string; subjects: { kind: string; name: string }[] }
      if (result.description.trim() === '') return 'write what the picture shows'
      const unknown = result.subjects.filter(subject => !known.some(candidate => candidate.kind === subject.kind && candidate.name === subject.name))
      return unknown.length === 0 ? undefined : `${unknown.map(subject => `${subject.name} (${subject.kind})`).join(', ')} is not in the list of the story: name only those that are`
    },
    maxCalls: 4,
  })
  return await updateImage(job.sessionFolder, job.path, { description: answer.description.trim(), tags: answer.tags.map(tag => tag.trim()).filter(tag => tag !== ''), subjects: answer.subjects })
}

