import type { IncomingMessage } from 'node:http'
import { HttpError } from './respond.ts'

/** Request bodies here are small JSON objects; anything larger is not one. */
const MAX_BODY_BYTES = 16 * 1024

/** Read a request body that must be a JSON object. */
export async function readJsonBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  const type = String(req.headers['content-type'] ?? '').split(';', 1)[0]?.trim().toLowerCase()
  if (type !== 'application/json') throw new HttpError(415, 'content-type must be application/json')
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req) {
    size += (chunk as Buffer).length
    if (size > MAX_BODY_BYTES) throw new HttpError(413, 'request body is too large')
    chunks.push(chunk as Buffer)
  }
  let body: unknown
  try {
    body = JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } catch {
    throw new HttpError(400, 'request body is not valid JSON')
  }
  if (typeof body !== 'object' || body === null || Array.isArray(body)) throw new HttpError(400, 'request body must be a JSON object')
  return body as Record<string, unknown>
}

/** Reads a request body of any kind up to `limit` bytes; a larger one is refused as soon as it is known to be, without being read. */
export async function readBinaryBody(req: IncomingMessage, limit: number): Promise<Buffer> {
  const declared = Number(req.headers['content-length'])
  if (Number.isFinite(declared) && declared > limit) throw new HttpError(413, `the upload is larger than ${Math.round(limit / 1024 / 1024)} MB`)
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req) {
    size += (chunk as Buffer).length
    if (size > limit) throw new HttpError(413, `the upload is larger than ${Math.round(limit / 1024 / 1024)} MB`)
    chunks.push(chunk as Buffer)
  }
  if (size === 0) throw new HttpError(400, 'the upload is empty')
  return Buffer.concat(chunks)
}
