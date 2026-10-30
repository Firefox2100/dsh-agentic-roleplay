import { lookup as resolve } from 'node:dns'
import { request as httpRequest, type IncomingMessage } from 'node:http'
import { request as httpsRequest } from 'node:https'
import { BlockList, isIP, type LookupFunction } from 'node:net'
import { MEDIA_TYPES } from '../images/image-files.ts'
import { addToLibraryOnce, imageExtensionOf, libraryHashes } from '../images/library.ts'
import { mapLimit } from './run.ts'

/** The address is not one a picture may be fetched from: it names this machine or a private network. */
export class BlockedAddressError extends Error {}

const MAX_BYTES = 20 * 1024 * 1024
const MIN_BYTES = 1024
const MAX_REDIRECTS = 4
const TIMEOUT_MS = 30_000
const CONCURRENCY = 8

const NON_IMAGE_EXTENSIONS = new Set([
  'js', 'mjs', 'cjs', 'css', 'html', 'htm', 'json', 'xml', 'txt', 'md', 'map', 'wasm', 'php', 'py', 'woff', 'woff2', 'ttf', 'otf', 'eot',
  'mp3', 'wav', 'ogg', 'flac', 'm4a', 'mp4', 'webm', 'mkv', 'mov', 'avi', 'zip', 'rar', 'gz', '7z', 'pdf', 'doc', 'docx',
])

const blocked = new BlockList()
for (const [network, prefix] of [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24],
  ['192.88.99.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15], ['198.51.100.0', 24], ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4],
] as const) blocked.addSubnet(network, prefix, 'ipv4')
for (const [network, prefix] of [
  ['::', 128], ['::1', 128], ['64:ff9b::', 96], ['100::', 64], ['2001::', 32], ['2001:db8::', 32], ['2002::', 16], ['fc00::', 7], ['fe80::', 10], ['ff00::', 8],
] as const) blocked.addSubnet(network, prefix, 'ipv6')

/** Whether an address may be connected to: only public unicast addresses may. */
export function isPublicAddress(address: string): boolean {
  const family = isIP(address)
  if (family === 0) return false
  if (family === 4) return !blocked.check(address, 'ipv4')
  const mapped = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i.exec(new URL(`http://[${address}]/`).hostname.replace(/^\[|\]$/g, ''))
  if (mapped !== null) {
    const high = Number.parseInt(mapped[1]!, 16)
    const low = Number.parseInt(mapped[2]!, 16)
    return isPublicAddress(`${high >> 8}.${high & 255}.${low >> 8}.${low & 255}`)
  }
  return !blocked.check(address, 'ipv6')
}

/** The address a picture may be asked for, or why not: web only, standard ports, no credentials, no private literal address. */
export function vetUrl(raw: string): URL | string {
  let url: URL
  try { url = new URL(raw) } catch { return 'not an address' }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return 'not a web address'
  if (url.username !== '' || url.password !== '') return 'has credentials'
  if (url.port !== '' && url.port !== '80' && url.port !== '443') return 'uses an unusual port'
  const host = url.hostname.replace(/^\[|\]$/g, '')
  if (isIP(host) !== 0 && !isPublicAddress(host)) return 'is a private address'
  return url
}

/** The addresses worth asking about: a picture file name, or a name with no file type at all. */
export function candidateUrls(urls: readonly string[]): { candidates: string[]; skipped: { url: string; reason: string }[] } {
  const candidates: string[] = []
  const skipped: { url: string; reason: string }[] = []
  const seen = new Set<string>()
  for (const raw of urls) {
    const url = vetUrl(raw)
    if (typeof url === 'string') { skipped.push({ url: raw, reason: url }); continue }
    url.hash = ''
    const key = url.href
    if (seen.has(key)) continue
    seen.add(key)
    const extension = /\.([a-z0-9]{1,5})$/i.exec(url.pathname)?.[1]?.toLowerCase()
    if (extension !== undefined && MEDIA_TYPES[`.${extension}`] === undefined) skipped.push({ url: raw, reason: NON_IMAGE_EXTENSIONS.has(extension) ? 'not an image' : 'format not supported' })
    else candidates.push(key)
  }
  return { candidates, skipped }
}

export interface Reply { status: number; type: string; location: string | undefined; body: Buffer }
export type Fetcher = (url: URL, method: 'HEAD' | 'GET', signal: AbortSignal) => Promise<Reply>

/** Looks the name up and refuses it when any answer is not public, at the moment of connecting, so a name cannot change between the check and the use. */
export const guardedLookup: LookupFunction = (hostname, options, callback) => {
  resolve(hostname, { ...options, all: true }, (error, addresses) => {
    if (error !== null) { callback(error, '', 0); return }
    const bad = addresses.find(entry => !isPublicAddress(entry.address))
    if (bad !== undefined || addresses.length === 0) { callback(new BlockedAddressError(`${hostname} is not a public address`), '', 0); return }
    if (options.all === true) callback(null, addresses as never)
    else callback(null, addresses[0]!.address, addresses[0]!.family)
  })
}

async function readBody(response: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of response as AsyncIterable<Buffer>) {
    size += chunk.length
    if (size > MAX_BYTES) { response.destroy(); throw new Error('too large') }
    chunks.push(chunk)
  }
  return Buffer.concat(chunks)
}

/** One request, never following a redirect, with the connection itself checked against private networks. */
export const requestOnce: Fetcher = (url, method, signal) => new Promise<Reply>((resolveReply, reject) => {
  const send = url.protocol === 'https:' ? httpsRequest : httpRequest
  const request = send(url, {
    method, lookup: guardedLookup, signal, timeout: TIMEOUT_MS, agent: false,
    headers: { 'user-agent': 'Mozilla/5.0 (compatible; dsh-roleplay-import)', accept: 'image/*,*/*;q=0.5', 'accept-encoding': 'identity' },
  }, (response) => {
    const status = response.statusCode ?? 0
    const type = String(response.headers['content-type'] ?? '').split(';')[0]!.trim().toLowerCase()
    const location = typeof response.headers.location === 'string' ? response.headers.location : undefined
    const length = Number(response.headers['content-length'] ?? 0)
    if (method === 'HEAD' || status < 200 || status >= 300 || (location !== undefined && status >= 300)) { response.destroy(); resolveReply({ status, type, location, body: Buffer.alloc(0) }); return }
    if (length > MAX_BYTES) { response.destroy(); reject(new Error('too large')); return }
    readBody(response).then(body => { resolveReply({ status, type, location, body }) }, reject)
  })
  request.on('timeout', () => { request.destroy(new Error('timed out')) })
  request.on('error', reject)
  request.end()
})

/** Asks for the address, following up to a few redirects, each vetted like the first address. */
export async function follow(fetcher: Fetcher, start: URL, method: 'HEAD' | 'GET', signal: AbortSignal): Promise<Reply> {
  let url = start
  for (let hop = 0; ; hop += 1) {
    const reply = await fetcher(url, method, signal)
    if (reply.status < 300 || reply.status >= 400 || reply.location === undefined) return reply
    if (hop >= MAX_REDIRECTS) throw new Error('too many redirects')
    const next = vetUrl(new URL(reply.location, url).href)
    if (typeof next === 'string') throw new BlockedAddressError(`a redirect ${next}`)
    url = next
  }
}

const GENERIC_TYPES = new Set(['', 'application/octet-stream', 'binary/octet-stream', 'application/binary', 'application/x-binary'])
const SUPPORTED_TYPES = new Set(Object.values(MEDIA_TYPES))

/** What a HEAD request says about an address: not a picture, or worth fetching (a picture, or an answer that settles nothing because the service does not do HEAD). */
async function worthFetching(fetcher: Fetcher, url: URL, signal: AbortSignal): Promise<string | undefined> {
  let reply: Reply
  try { reply = await follow(fetcher, url, 'HEAD', signal) } catch (error) {
    return error instanceof BlockedAddressError ? error.message : undefined
  }
  if (reply.status === 404 || reply.status === 410) return 'gone'
  if (reply.status < 200 || reply.status >= 300) return undefined
  if (reply.type.startsWith('image/')) return SUPPORTED_TYPES.has(reply.type) ? undefined : 'format not supported'
  return GENERIC_TYPES.has(reply.type) ? undefined : `not an image (${reply.type})`
}

function fileNameOf(url: URL): string {
  const last = url.pathname.split('/').pop() ?? ''
  try { return decodeURIComponent(last) || 'image' } catch { return last || 'image' }
}

export interface PicturesReport {
  /** Addresses in the card that looked like pictures. */
  found: number
  /** Where each picture went, under `images/`. */
  added: { url: string; path: string }[]
  /** `of`: for a copy, the library picture it is a copy of. */
  skipped: { url: string; reason: string; of?: string }[]
}

export interface PictureDeps { fetcher?: Fetcher; signal?: AbortSignal; concurrency?: number }

/**
 * Fetches the pictures a card points to into the world's image library, as if the person had added them. Each address is vetted, asked about
 * with HEAD, and only then downloaded; what is kept is decided by the first bytes of the file, never by its name or declared type.
 */
export async function fetchPictures(world: string, urls: readonly string[], deps: PictureDeps = {}): Promise<PicturesReport> {
  const fetcher = deps.fetcher ?? requestOnce
  const { candidates, skipped: refused } = candidateUrls(urls)
  const skipped: PicturesReport['skipped'] = [...refused]
  const added: { url: string; path: string }[] = []
  const hashes = await libraryHashes(world)
  await mapLimit(candidates, deps.concurrency ?? CONCURRENCY, async (address) => {
    const signal = AbortSignal.any([AbortSignal.timeout(TIMEOUT_MS * 2), ...(deps.signal === undefined ? [] : [deps.signal])])
    const url = new URL(address)
    try {
      const refusal = await worthFetching(fetcher, url, signal)
      if (refusal !== undefined) { skipped.push({ url: address, reason: refusal }); return }
      const reply = await follow(fetcher, url, 'GET', signal)
      if (reply.status < 200 || reply.status >= 300) { skipped.push({ url: address, reason: `answered ${reply.status}` }); return }
      if (imageExtensionOf(reply.body) === undefined) { skipped.push({ url: address, reason: 'not an image' }); return }
      if (reply.body.length < MIN_BYTES) { skipped.push({ url: address, reason: 'too small' }); return }
      const { path, added: isNew } = await addToLibraryOnce(world, reply.body, fileNameOf(url), hashes)
      if (!isNew) { skipped.push({ url: address, reason: 'a copy of another picture', of: path }); return }
      added.push({ url: address, path })
    } catch (error) {
      skipped.push({ url: address, reason: error instanceof Error ? error.message : String(error) })
    }
  })
  return { found: candidates.length, added, skipped }
}

/** The key an address is known by: the way `candidateUrls` reads it, without a fragment. */
export function addressKey(raw: string): string {
  try { const url = new URL(raw); url.hash = ''; return url.href } catch { return raw }
}

const FINAL = [/^not an? /, /^format not supported/, /^gone$/, /^too small$/, /^too large$/, /^a copy of /, /^has credentials/, /^uses an unusual port/, /^is a private address/, /^a redirect /, /is not a public address$/, /^answered (4(?!08|29)\d\d)$/]

/** Whether asking again could give another answer: a picture that is not one, is gone or may not be fetched stays settled; a timeout, a server error or a refusal to wait does not. */
export const worthAskingAgain = (reason: string): boolean => !FINAL.some(pattern => pattern.test(reason))

/**
 * The addresses of a newer card to ask for: those the earlier card did not have, and those it had that were not settled (the record says a request failed). With no record
 * of that fetch every address of the earlier card counts as settled, so what the person removed from the library is not brought back.
 */
export function addressesToFetch(earlier: readonly string[], later: readonly string[], record: PicturesReport | undefined): string[] {
  const settled = new Set(earlier.map(addressKey))
  if (record !== undefined) {
    const unsettled = new Set(record.skipped.filter(entry => worthAskingAgain(entry.reason)).map(entry => addressKey(entry.url)))
    const fetched = new Set(record.added.map(entry => addressKey(entry.url)))
    for (const key of [...settled]) if (unsettled.has(key) && !fetched.has(key)) settled.delete(key)
  }
  return later.filter(url => !settled.has(addressKey(url)))
}

/** The record after a second fetch: what was added stays, an address asked again takes its new answer. */
export function mergeReports(earlier: PicturesReport | undefined, later: PicturesReport, found: number): PicturesReport {
  const asked = new Set([...later.added.map(entry => entry.url), ...later.skipped.map(entry => entry.url)].map(addressKey))
  return {
    found,
    added: [...(earlier?.added ?? []), ...later.added],
    skipped: [...(earlier?.skipped ?? []).filter(entry => !asked.has(addressKey(entry.url))), ...later.skipped],
  }
}
