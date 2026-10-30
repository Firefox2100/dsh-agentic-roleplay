import { createReadStream } from 'node:fs'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { pipeline } from 'node:stream/promises'
import { languageOf } from '../../prompts/library.ts'
import { InvalidEditProblems } from '../../../shared/world-state.ts'
import { AgentUnavailableError } from '../../sessions/errors.ts'
import type { ImageUpdate } from '../../images/gallery.ts'
import { CatalogueError, type CatalogueFailure } from '../../catalogue/errors.ts'
import { ImportCardError } from '../../import/card.ts'
import { ImportNotFoundError } from '../../import/store.ts'
import { sendError, sendJson } from '../respond.ts'

/** Pieces the route files of the API share. */
export type Routes = Record<string, Partial<Record<string, Route>>>
export type Route = (req: IncomingMessage, res: ServerResponse, url: URL) => Promise<void>

/** The largest picture that can be added to a gallery. */
export const MAX_UPLOAD_BYTES = 20 * 1024 * 1024

/** The changes to a picture's metadata a body asks for, or what is wrong with it. */
export function imageUpdateOf(body: Record<string, unknown>): ImageUpdate | string {
  const update: ImageUpdate = {}
  if (body['reusable'] !== undefined) { if (typeof body['reusable'] !== 'boolean') return 'reusable must be true or false'; update.reusable = body['reusable'] }
  if (body['description'] !== undefined) { if (typeof body['description'] !== 'string') return 'description must be text'; update.description = body['description'].trim() }
  if (body['tags'] !== undefined) { if (!Array.isArray(body['tags']) || !body['tags'].every(tag => typeof tag === 'string')) return 'tags must be a list of text'; update.tags = (body['tags'] as string[]).map(tag => tag.trim()).filter(tag => tag !== '') }
  return update
}

export async function sendImage(res: ServerResponse, image: { file: string; size: number; mediaType?: string }): Promise<void> {
  res.statusCode = 200
  res.setHeader('content-type', image.mediaType ?? 'image/png')
  res.setHeader('content-length', image.size)
  res.setHeader('x-content-type-options', 'nosniff')
  res.setHeader('cache-control', 'private, max-age=31536000, immutable')
  await pipeline(createReadStream(image.file), res)
}

export const CATALOGUE_STATUS: Record<CatalogueFailure, number> = { input: 400, unknown: 404, upstream: 502, invalid: 422, conflict: 409, unavailable: 503 }

/** A catalogue failure with the status that says whose fault it is; anything else is not ours to describe. */
export function catalogueFailure(res: ServerResponse, error: unknown): void {
  if (error instanceof CatalogueError) return error.detail === undefined ? sendError(res, CATALOGUE_STATUS[error.failure], error.message) : sendJson(res, CATALOGUE_STATUS[error.failure], { message: error.message, ...error.detail })
  throw error
}

/** The world a card is to update, when the request names one. */
export function updateField(body: unknown): string | undefined {
  const value = typeof body === 'object' && body !== null ? (body as { update?: unknown }).update : undefined
  return typeof value === 'string' && value.trim() !== '' ? value : undefined
}

/** The status an import failure is shown with: what is wrong with the card or the choices is the person's to fix. */
export function importFailure(res: ServerResponse, error: unknown): void {
  if (error instanceof ImportCardError) return sendError(res, 422, error.message)
  if (error instanceof ImportNotFoundError) return sendError(res, 404, error.message)
  if (error instanceof InvalidEditProblems) return sendJson(res, 422, { message: error.message, problems: error.problems })
  if (error instanceof AgentUnavailableError) return sendError(res, 503, error.message)
  throw error
}

/** The language a client says it is using, or nothing when it says none. */
export function languageField(value: unknown): string | undefined {
  if (value === undefined) return undefined
  if (typeof value !== 'string') throw new InvalidEditProblems(['language must be text'])
  try { return languageOf(value) } catch (error) { throw new InvalidEditProblems([error instanceof Error ? error.message : String(error)]) }
}

