import { request as httpRequest } from 'node:http'
import { request as httpsRequest } from 'node:https'
import { guardedLookup, vetUrl } from '../import/pictures.ts'
import { CatalogueError } from './errors.ts'
import type { Sources } from './sources.ts'

export interface Reply { status: number; type: string; location: string | undefined; body: Buffer }
export interface Ask { headers: Record<string, string>; guarded: boolean; maxBytes: number; signal: AbortSignal }
export type Transport = (url: URL, ask: Ask) => Promise<Reply>

const TIMEOUT_MS = 60_000
const MAX_REDIRECTS = 5

export const nodeTransport: Transport = (url, ask) => new Promise<Reply>((resolveReply, reject) => {
  const send = url.protocol === 'https:' ? httpsRequest : httpRequest
  const request = send(url, {
    method: 'GET', signal: ask.signal, timeout: TIMEOUT_MS, agent: false,
    headers: { 'user-agent': 'dsh-agentic-roleplay', 'accept-encoding': 'identity', ...ask.headers },
    ...(ask.guarded ? { lookup: guardedLookup } : {}),
  }, (response) => {
    const status = response.statusCode ?? 0
    const location = typeof response.headers.location === 'string' ? response.headers.location : undefined
    const type = String(response.headers['content-type'] ?? '').split(';')[0]!.trim().toLowerCase()
    if (status >= 300 && status < 400 && location !== undefined) { response.destroy(); resolveReply({ status, type, location, body: Buffer.alloc(0) }); return }
    if (Number(response.headers['content-length'] ?? 0) > ask.maxBytes) { response.destroy(); reject(new CatalogueError(`the answer is larger than ${ask.maxBytes} bytes`, 'upstream')); return }
    const chunks: Buffer[] = []
    let size = 0
    response.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > ask.maxBytes) { response.destroy(); reject(new CatalogueError(`the answer is larger than ${ask.maxBytes} bytes`, 'upstream')); return }
      chunks.push(chunk)
    })
    response.on('end', () => { resolveReply({ status, type, location, body: Buffer.concat(chunks) }) })
    response.on('error', reject)
  })
  request.on('timeout', () => { request.destroy(new Error('timed out')) })
  request.on('error', reject)
  request.end()
})

export interface Fetching { sources: Sources; transport?: Transport; maxBytes: number; accept: string; signal?: AbortSignal }

/**
 * Asks for an address. An address on a configured catalogue's site carries that catalogue's API key and may be a local address (the person
 * named that site); any other address is asked for plainly and only if it is a public one. A redirect is judged like a first address, so
 * the key never goes to another site.
 * @throws {CatalogueError} when the address cannot be used or the answer is not a success.
 */
export async function fetchAddress(address: string, options: Fetching): Promise<Reply> {
  const transport = options.transport ?? nodeTransport
  const signal = AbortSignal.any([AbortSignal.timeout(TIMEOUT_MS * 4), ...(options.signal === undefined ? [] : [options.signal])])
  let url = new URL(address)
  for (let hop = 0; ; hop += 1) {
    if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new CatalogueError(`${url.href} is not a web address`, 'input')
    if (url.username !== '' || url.password !== '') throw new CatalogueError(`${url.origin} must not carry a user name or password: use the API key field`, 'input')
    const source = options.sources.match(url)
    if (source === undefined) {
      const vetted = vetUrl(url.href)
      if (typeof vetted === 'string') throw new CatalogueError(`${url.href} ${vetted}`, 'input')
    }
    const key = source === undefined ? undefined : await options.sources.key(source)
    let reply: Reply
    try {
      reply = await transport(url, { headers: { accept: options.accept, ...(key === undefined ? {} : { authorization: `Bearer ${key}` }) }, guarded: source === undefined, maxBytes: options.maxBytes, signal })
    } catch (error) {
      if (error instanceof CatalogueError) throw error
      throw new CatalogueError(`could not reach ${url.origin}: ${error instanceof Error ? error.message : String(error)}`, 'upstream')
    }
    if (reply.status >= 300 && reply.status < 400 && reply.location !== undefined) {
      if (hop >= MAX_REDIRECTS) throw new CatalogueError('too many redirects', 'upstream')
      url = new URL(reply.location, url)
      continue
    }
    if (reply.status >= 200 && reply.status < 300) return reply
    throw new CatalogueError(refusal(url, reply.status, source !== undefined, key !== undefined), reply.status === 404 ? 'unknown' : 'upstream')
  }
}

function refusal(url: URL, status: number, known: boolean, keyed: boolean): string {
  if (status === 401 || status === 403) {
    if (keyed) return `${url.origin} refused the API key (answered ${status}): check it in Settings, Role Play`
    return known
      ? `${url.origin} needs an API key (answered ${status}): add one for this catalogue in Settings, Role Play`
      : `${url.origin} needs a sign-in (answered ${status}): add its catalogue with an API key in Settings, Role Play`
  }
  if (status === 404) return `${url.href} was not found${keyed ? '' : ', or it is private and needs an API key'}`
  return `${url.origin} answered ${status} for ${url.pathname}`
}
