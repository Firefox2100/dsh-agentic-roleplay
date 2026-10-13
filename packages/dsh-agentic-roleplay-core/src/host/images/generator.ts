import type { ImageGenerationService } from '@dsh-ai-providers/core'
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
  /** Whether the picture may be shown again in a later scene: true when it shows a place, a lasting look or a repeatable mood rather than a one-off event. */
  reusable?: boolean
  signal?: AbortSignal
}

const unique = (values: readonly string[]): string[] => [...new Set(values.map(value => value.trim()).filter(value => value !== ''))]

/** What a reference image shows: the subject and its stable look. */
export function referenceDescription(request: Pick<ReferenceImageRequest, 'subject' | 'identity'>): string {
  return `${request.subject.name} (${request.subject.kind}): ${request.identity.description}`.trim()
}

/** What a scene image shows: the established moment, then how each subject looks in it. */
export function transientDescription(request: Pick<TransientImageRequest, 'scene' | 'subjects'>): string {
  return [request.scene.trim(), ...request.subjects.map(subject => (subject.transient.trim() === '' ? undefined : `${subject.name}: ${subject.transient.trim()}`))].filter(part => part !== undefined && part !== '').join('\n')
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
    schema: 'dsh-roleplay-image/v3', purpose: 'reference', origin: 'generated', reusable: true, createdAt: new Date().toISOString(), prompt,
    description: referenceDescription(request), tags: unique([request.subject.name, ...request.identity.tags]),
    ...(image.revisedPrompt === undefined ? {} : { revisedPrompt: image.revisedPrompt }),
    provider: service.provider, model: image.model, subjects: [{ ...request.subject, identityVersion: request.identity.version }],
  }
  await writeImage(path, image.data, metadata, { replace: true })
  return path
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]

/** Takes a picture the person brought as the stable reference.png of one entity, replacing the one there. Only PNG is stored, so any other format is refused. */
export async function uploadReferenceImage(request: { root: string; subject: VisualImageSubject; png: Uint8Array; originalName?: string }): Promise<string> {
  if (request.png.length < PNG_SIGNATURE.length || PNG_SIGNATURE.some((byte, index) => request.png[index] !== byte)) throw new Error('the portrait must be a PNG picture: convert it first')
  const path = referenceImagePath(request.root, request.subject)
  const metadata: VisualImageMetadata = {
    schema: 'dsh-roleplay-image/v3', purpose: 'reference', origin: 'uploaded', reusable: true, createdAt: new Date().toISOString(),
    description: `${request.subject.name}, a picture brought by the author.`, tags: [request.subject.name],
    ...(request.originalName === undefined ? {} : { originalName: request.originalName }), subjects: [request.subject],
  }
  await writeImage(path, request.png, metadata, { replace: true })
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
    schema: 'dsh-roleplay-image/v3', purpose: 'transient', origin: 'generated', reusable: request.reusable === true, createdAt: new Date().toISOString(), prompt,
    description: transientDescription(request), tags: unique(request.subjects.flatMap(subject => [subject.name, ...subject.identity.tags])),
    ...(image.revisedPrompt === undefined ? {} : { revisedPrompt: image.revisedPrompt }),
    provider: service.provider, model: image.model,
    subjects: request.subjects.map(({ identity, transient: _transient, ...subject }) => ({ ...subject, identityVersion: identity.version })),
    source: { turn: request.turn, timelineNode: request.timelineNode, ...(request.segment === undefined ? {} : { segment: request.segment }) },
  }
  await writeImage(path, image.data, metadata)
  return path
}

export type { EntityImageAddress }
