import type { ServerResponse } from 'node:http'

export function sendJson(res: ServerResponse, status: number, payload: unknown): void {
  res.statusCode = status
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.setHeader('cache-control', 'no-store')
  res.end(JSON.stringify(payload))
}

export function sendError(res: ServerResponse, status: number, message: string): void {
  sendJson(res, status, { message })
}

/** A failure with the status the client should see. */
export class HttpError extends Error {
  constructor(readonly status: number, message: string) {
    super(message)
  }
}
