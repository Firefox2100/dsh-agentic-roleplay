import { CREDENTIAL_REF, catalogueKeyRef, type CatalogueKeyStatus, type CatalogueSource, type CatalogueSourceStatus } from '../../shared/catalogue.ts'
import { CatalogueError } from './errors.ts'

/** A configured catalogue that can be used: its address is a web address and its name is unique. */
export interface ResolvedSource {
  name: string
  /** The API root, without a trailing slash: the site and the path the API lives under. */
  root: string
  origin: string
  prefix: string
  /** The credential the key is looked up under. */
  keyRef: string
  /** A key still written in the profile's configuration by an earlier version. */
  legacyKey: string | undefined
}

/** The part of DSH's credential service the catalogues use; the service is not there in a profile without it. */
export interface CredentialStore {
  resolve(ref: string): Promise<{ value: string; source: string } | undefined>
  describe(ref: string): Promise<{ configured: boolean; source?: string; writable: boolean }>
  set(ref: string, value: string): Promise<void>
  unset(ref: string): Promise<void>
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
  /** `store` is looked up on each use: a key saved or rotated reaches the next request without a restart. */
  constructor(private readonly read: () => readonly CatalogueSource[], private readonly store: () => CredentialStore | undefined = () => undefined) {}

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
      const keyRef = source.apiKeyRef.trim() === '' ? catalogueKeyRef(name) : source.apiKeyRef.trim()
      if (!CREDENTIAL_REF.test(keyRef)) return { source, problem: `has a key name "${keyRef}" that is not a credential name (letters, digits and "_", not starting with a digit)` }
      return { source, resolved: { name, root: `${base.origin}${prefix}`, origin: base.origin, prefix, keyRef, legacyKey: source.apiKey.trim() === '' ? undefined : source.apiKey.trim() } }
    })
  }

  /** The catalogue's key: the credential store's value for its reference, else the one an earlier version wrote in the configuration. */
  async key(source: ResolvedSource): Promise<string | undefined> {
    const store = this.store()
    if (store !== undefined) {
      let found
      try { found = await store.resolve(source.keyRef) } catch (error) { throw new CatalogueError(`could not read the key "${source.keyRef}" of the catalogue "${source.name}": ${error instanceof Error ? error.message : String(error)}`, 'invalid') }
      if (found !== undefined) return found.value
    }
    return source.legacyKey
  }

  async status(): Promise<CatalogueSourceStatus[]> {
    const store = this.store()
    return await Promise.all(this.resolved().map(async ({ source, resolved, problem }) => {
      const keyRef = resolved?.keyRef ?? (source.apiKeyRef.trim() === '' ? catalogueKeyRef(source.name) : source.apiKeyRef.trim())
      const stored = resolved === undefined || store === undefined ? undefined : await store.describe(keyRef)
      const legacy = source.apiKey.trim() !== ''
      return {
        name: source.name.trim(), baseUrl: source.baseUrl.trim(), keyRef,
        hasKey: stored?.configured === true || legacy,
        ...(stored?.configured === true && stored.source !== undefined ? { keySource: stored.source } : legacy ? { keySource: 'configuration' } : {}),
        ...(legacy ? { legacyKey: true } : {}),
        ...(resolved === undefined ? { problem: problem ?? 'cannot be used' } : {}),
      }
    }))
  }

  /** The credential store's account of a reference, for the settings page; never the value. @throws {CatalogueError} when the profile has no credential store. */
  async describe(ref: string): Promise<CatalogueKeyStatus> {
    const info = await this.needStore().describe(this.reference(ref))
    return { ref, configured: info.configured, writable: info.writable, ...(info.source === undefined ? {} : { source: info.source }) }
  }

  /** Stores a key from the settings page, or removes the stored one when the value is empty. @throws {CatalogueError} when the store refuses. */
  async keep(ref: string, value: string): Promise<CatalogueKeyStatus> {
    const store = this.needStore()
    try {
      if (value === '') await store.unset(this.reference(ref))
      else await store.set(this.reference(ref), value)
    } catch (error) {
      if (error instanceof CatalogueError) throw error
      throw new CatalogueError(error instanceof Error ? error.message : 'the key could not be stored', 'conflict')
    }
    return await this.describe(ref)
  }

  private reference(ref: string): string {
    if (!CREDENTIAL_REF.test(ref)) throw new CatalogueError(`"${ref}" is not a credential name (letters, digits and "_", not starting with a digit)`, 'input')
    return ref
  }

  private needStore(): CredentialStore {
    const store = this.store()
    if (store === undefined) throw new CatalogueError('this profile has no credential store, so keys cannot be kept from here', 'unavailable')
    return store
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
