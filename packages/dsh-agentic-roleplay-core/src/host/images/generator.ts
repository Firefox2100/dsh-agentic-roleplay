import type { ImageGenerationService } from 'dsh-ai-core'
import type { VisualIdentity } from 'dsh-roleplay-model'
import { referenceImagePath, sceneImagePath, writeImage, type EntityImageAddress, type VisualImageMetadata, type VisualImageSubject } from './storage.ts'

export interface ReferenceImageRequest {
  root: string
  subject: VisualImageSubject
  identity: VisualIdentity
  artDirection?: string
  signal?: AbortSignal
}

export interface TransientSubject extends VisualImageSubject {
  identity: VisualIdentity
  /** Only what differs for this image: expression, clothing, condition, activity, pose and interaction. */
  transient: string
}

export interface TransientImageRequest {
  root: string
  timelineNode: string
  turn: number
  serial: number
  segment?: number
  scene: string
  subjects: TransientSubject[]
  artDirection?: string
  references?: { data: Blob; description?: string }[]
  signal?: AbortSignal
}

function lines(parts: readonly (string | undefined)[]): string {
  return parts.filter((part): part is string => part !== undefined && part.trim() !== '').join('\n')
}

export function referencePrompt(request: Pick<ReferenceImageRequest, 'subject' | 'identity' | 'artDirection'>): string {
  const { subject, identity } = request
  return lines([
    request.artDirection,
    `Create a canonical reference image of the ${subject.kind} ${subject.name}.`,
    identity.description,
    identity.tags.length === 0 ? undefined : `Stable visual traits: ${identity.tags.join(', ')}.`,
    'Show the subject clearly and neutrally. Do not add story events or temporary changes.',
    identity.negativeTags.length === 0 ? undefined : `Avoid: ${identity.negativeTags.join(', ')}.`,
  ])
}

export function transientPrompt(request: Pick<TransientImageRequest, 'scene' | 'subjects' | 'artDirection'>): string {
  return lines([
    request.artDirection,
    `Illustrate this established story moment: ${request.scene}`,
    ...request.subjects.map(subject => lines([
      `${subject.kind} ${subject.name}: ${subject.identity.description}`,
      subject.identity.tags.length === 0 ? undefined : `Stable visual traits: ${subject.identity.tags.join(', ')}.`,
      subject.transient === '' ? undefined : `Current visible state: ${subject.transient}`,
    ])),
    'Preserve every canonical identity. Depict only the stated subjects, state and action; do not invent story facts.',
    request.subjects.flatMap(subject => subject.identity.negativeTags).length === 0 ? undefined : `Avoid: ${[...new Set(request.subjects.flatMap(subject => subject.identity.negativeTags))].join(', ')}.`,
  ])
}

async function firstPng(service: ImageGenerationService, prompt: string, options: { references?: { data: Blob; description?: string }[]; signal?: AbortSignal } = {}): Promise<{ data: Uint8Array; model: string; revisedPrompt?: string }> {
  const result = await service.generate(prompt, { count: 1, ...options })
  const image = result.images[0]
  if (image === undefined) throw new Error(`${service.provider} returned no image`)
  if (image.mediaType !== 'image/png') throw new Error(`${service.provider} returned ${image.mediaType}; roleplay image storage currently requires PNG`)
  return { data: new Uint8Array(await image.data.arrayBuffer()), model: result.model, ...(image.revisedPrompt === undefined ? {} : { revisedPrompt: image.revisedPrompt }) }
}

/** Generates the stable reference.png of one entity. It is intentionally not registered in the live roleplay loop yet. */
export async function generateReferenceImage(service: ImageGenerationService, request: ReferenceImageRequest): Promise<string> {
  const prompt = referencePrompt(request)
  const image = await firstPng(service, prompt, request.signal === undefined ? {} : { signal: request.signal })
  request.signal?.throwIfAborted()
  const path = referenceImagePath(request.root, request.subject)
  const metadata: VisualImageMetadata = {
    schema: 'dsh-roleplay-image/v1', purpose: 'reference', createdAt: new Date().toISOString(), prompt,
    ...(image.revisedPrompt === undefined ? {} : { revisedPrompt: image.revisedPrompt }),
    provider: service.provider, model: image.model, subjects: [{ ...request.subject, identityVersion: request.identity.version }],
  }
  await writeImage(path, image.data, metadata, { replace: true })
  return path
}

/** Generates one immutable scene image for a timeline node. It is intentionally not registered in the live roleplay loop yet. */
export async function generateTransientImage(service: ImageGenerationService, request: TransientImageRequest): Promise<string> {
  if (request.subjects.length === 0) throw new Error('a transient image needs at least one subject')
  const prompt = transientPrompt(request)
  const image = await firstPng(service, prompt, { ...(request.references === undefined ? {} : { references: request.references }), ...(request.signal === undefined ? {} : { signal: request.signal }) })
  request.signal?.throwIfAborted()
  const path = sceneImagePath(request.root, request.timelineNode, request.serial)
  const metadata: VisualImageMetadata = {
    schema: 'dsh-roleplay-image/v1', purpose: 'transient', createdAt: new Date().toISOString(), prompt,
    ...(image.revisedPrompt === undefined ? {} : { revisedPrompt: image.revisedPrompt }),
    provider: service.provider, model: image.model,
    subjects: request.subjects.map(({ identity, transient: _transient, ...subject }) => ({ ...subject, identityVersion: identity.version })),
    source: { turn: request.turn, timelineNode: request.timelineNode, ...(request.segment === undefined ? {} : { segment: request.segment }) },
  }
  await writeImage(path, image.data, metadata)
  return path
}

export type { EntityImageAddress }
