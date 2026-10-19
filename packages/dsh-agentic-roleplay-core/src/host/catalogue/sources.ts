import type { CatalogueSource, CatalogueSourceStatus } from '../../shared/catalogue.ts'
import { CatalogueError } from './errors.ts'

/** A configured catalogue that can be used: its address is a web address and its name is unique. */
export interface ResolvedSource {
  name: string
  /** The API root, without a trailing slash: the site and the path the API lives under. */
  root: string
  origin: string
  prefix: string
  apiKey: string | undefined
}

/** A web address with no credentials, query or fragment, or the reason it is not one. */
export function parseBase(text: string): URL | string {
  let url: URL
  try { url = new URL(text.trim()) } catch { return 'is not an address' }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return 'is not a web address'
  if (url.username !== '' || url.password !== '') return 'must not carry a user name or password: use the API key field'
  if (url.search !== '' || url.hash !== '') return 'must not have a query or fragment'
  return url
}

const prefixLength = (prefix: string, path: string): number => (prefix === '' || path === prefix || path.startsWith(`${prefix}/`) ? prefix.length : -1)

/** The catalogues the person configured, read afresh on every use so an edit applies at once. */
export class Sources {
  constructor(private readonly read: () => readonly CatalogueSource[]) {}

  private resolved(): { source: CatalogueSource; resolved?: ResolvedSource; problem?: string }[] {
    const seen = new Set<string>()
    return this.read().map((source) => {
      const name = source.name.trim()
      if (name === '') return { source, problem: 'has no name' }
      if (seen.has(name)) return { source, problem: 'repeats the name of an earlier catalogue' }
      seen.add(name)
      const base = parseBase(source.baseUrl)
      if (typeof base === 'string') return { source, problem: `address ${base}` }
      const prefix = base.pathname.replace(/\/+$/, '')
      return { source, resolved: { name, root: `${base.origin}${prefix}`, origin: base.origin, prefix, apiKey: source.apiKey.trim() === '' ? undefined : source.apiKey.trim() } }
    })
  }

  status(): CatalogueSourceStatus[] {
    return this.resolved().map(({ source, resolved, problem }) => ({
      name: source.name.trim(), baseUrl: source.baseUrl.trim(), hasKey: source.apiKey.trim() !== '',
      ...(resolved === undefined ? { problem: problem ?? 'cannot be used' } : {}),
    }))
  }

  /** @throws {CatalogueError} when no usable catalogue has the name. */
  get(name: string): ResolvedSource {
    const entry = this.resolved().find(candidate => candidate.source.name.trim() === name)
    if (entry === undefined) throw new CatalogueError(`there is no catalogue named "${name}"`, 'unknown')
    if (entry.resolved === undefined) throw new CatalogueError(`the catalogue "${name}" ${entry.problem ?? 'cannot be used'}`, 'invalid')
    return entry.resolved
  }

  /** The catalogue an address belongs to: the same site, preferring the one whose address is the longest start of the path. */
  match(url: URL): ResolvedSource | undefined {
    let best: { source: ResolvedSource; length: number } | undefined
    for (const { resolved } of this.resolved()) {
      if (resolved === undefined || resolved.origin !== url.origin) continue
      const length = prefixLength(resolved.prefix, url.pathname)
      if (best === undefined || length > best.length) best = { source: resolved, length }
    }
    return best?.source
  }
}
