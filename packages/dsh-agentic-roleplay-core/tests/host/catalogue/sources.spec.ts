import { describe, expect, it } from 'vitest'
import { catalogueKeyRef } from '../../../src/shared/catalogue.ts'
import { parseBase, Sources, type CredentialStore } from '../../../src/host/catalogue/sources.ts'

const sources = new Sources(() => [
  { name: 'Home', baseUrl: 'http://localhost:9798/', apiKeyRef: '', apiKey: 'home-key' },
  { name: 'Site API', baseUrl: 'https://cat.example/api', apiKeyRef: '', apiKey: 'api-key' },
  { name: 'Site', baseUrl: 'https://cat.example', apiKeyRef: '', apiKey: '' },
  { name: 'Home', baseUrl: 'https://other.example', apiKeyRef: '', apiKey: '' },
  { name: 'Broken', baseUrl: 'ftp://x', apiKeyRef: '', apiKey: '' },
  { name: ' ', baseUrl: 'https://blank.example', apiKeyRef: '', apiKey: '' },
])

describe('the configured catalogues', () => {
  it('say which can be used, which have a key, and why the others cannot', async () => {
    expect(await sources.status()).toEqual([
      { name: 'Home', baseUrl: 'http://localhost:9798/', hasKey: true, keyRef: 'ROLEPLAY_CATALOGUE_HOME_API_KEY', keySource: 'configuration', legacyKey: true },
      { name: 'Site API', baseUrl: 'https://cat.example/api', hasKey: true, keyRef: 'ROLEPLAY_CATALOGUE_SITE_API_API_KEY', keySource: 'configuration', legacyKey: true },
      { name: 'Site', baseUrl: 'https://cat.example', hasKey: false, keyRef: 'ROLEPLAY_CATALOGUE_SITE_API_KEY' },
      { name: 'Home', baseUrl: 'https://other.example', hasKey: false, keyRef: 'ROLEPLAY_CATALOGUE_HOME_API_KEY', problem: 'repeats the name of an earlier catalogue' },
      { name: 'Broken', baseUrl: 'ftp://x', hasKey: false, keyRef: 'ROLEPLAY_CATALOGUE_BROKEN_API_KEY', problem: 'address is not a web address' },
      { name: '', baseUrl: 'https://blank.example', hasKey: false, keyRef: 'ROLEPLAY_CATALOGUE_X_811C9DC5_API_KEY', problem: 'has no name' },
    ])
  })

  it('are found by name, and an unusable one is refused out loud', () => {
    expect(sources.get('Home').root).toBe('http://localhost:9798')
    expect(() => sources.get('Nowhere')).toThrow(/no catalogue named/)
    expect(() => sources.get('Broken')).toThrow(/not a web address/)
  })

  it('own an address by its site, preferring the longest start of the path', () => {
    expect(sources.match(new URL('https://cat.example/api/versions/1/download'))?.name).toBe('Site API')
    expect(sources.match(new URL('https://cat.example/other'))?.name).toBe('Site')
    expect(sources.match(new URL('http://localhost:9798/versions/1/download'))?.name).toBe('Home')
    expect(sources.match(new URL('http://localhost:9799/versions/1/download'))).toBeUndefined()
    expect(sources.match(new URL('https://evil.example/api/versions/1'))).toBeUndefined()
  })

  it('refuse an address that carries a login, a query or is not on the web', () => {
    expect(parseBase('https://u:p@x.example')).toMatch(/user name/)
    expect(parseBase('https://x.example?a=1')).toMatch(/query/)
    expect(parseBase('nonsense')).toMatch(/not an address/)
    expect((sources.get('Site API')).root).toBe('https://cat.example/api')
  })
})

/** A credential store that keeps its values in memory, with the references the launch environment supplies. */
function memoryStore(values: Record<string, string> = {}, fromEnvironment: string[] = []): CredentialStore & { values: Record<string, string> } {
  return {
    values,
    resolve: ref => Promise.resolve(values[ref] === undefined || values[ref] === '' ? undefined : { value: values[ref]!, source: fromEnvironment.includes(ref) ? 'env' : 'file' }),
    describe: ref => Promise.resolve({ configured: values[ref] !== undefined && values[ref] !== '', writable: !fromEnvironment.includes(ref), ...(values[ref] === undefined ? {} : { source: fromEnvironment.includes(ref) ? 'env' : 'file' }) }),
    set: (ref, value) => { if (fromEnvironment.includes(ref)) return Promise.reject(new Error('the launch environment supplies it')); values[ref] = value; return Promise.resolve() },
    unset: (ref) => { if (fromEnvironment.includes(ref)) return Promise.reject(new Error('the launch environment supplies it')); delete values[ref]; return Promise.resolve() },
  }
}

describe('the key of a catalogue', () => {
  const entry = (patch: Partial<{ apiKeyRef: string; apiKey: string }> = {}) => [{ name: 'Home', baseUrl: 'http://localhost:9798', apiKeyRef: '', apiKey: '', ...patch }]

  it('is read from the credential store on every use, so a changed key reaches the next request', async () => {
    const store = memoryStore()
    const home = new Sources(() => entry(), () => store)
    expect(await home.key(home.get('Home'))).toBeUndefined()
    store.values['ROLEPLAY_CATALOGUE_HOME_API_KEY'] = 'one'
    expect(await home.key(home.get('Home'))).toBe('one')
    store.values['ROLEPLAY_CATALOGUE_HOME_API_KEY'] = 'two'
    expect(await home.key(home.get('Home'))).toBe('two')
  })

  it('is looked up under the name the entry gives, and the store outranks a key left in the configuration', async () => {
    const store = memoryStore({ MY_KEY: 'stored' })
    const home = new Sources(() => entry({ apiKeyRef: 'MY_KEY', apiKey: 'old' }), () => store)
    expect(await home.key(home.get('Home'))).toBe('stored')
    delete store.values['MY_KEY']
    expect(await home.key(home.get('Home'))).toBe('old')
    expect(await home.status()).toMatchObject([{ keyRef: 'MY_KEY', hasKey: true, keySource: 'configuration', legacyKey: true }])
  })

  it('says where the key comes from without telling it, and is refused a name that is not a credential name', async () => {
    const store = memoryStore({ ROLEPLAY_CATALOGUE_HOME_API_KEY: 'x' }, ['ROLEPLAY_CATALOGUE_HOME_API_KEY'])
    const home = new Sources(() => entry(), () => store)
    expect(await home.status()).toEqual([{ name: 'Home', baseUrl: 'http://localhost:9798', hasKey: true, keyRef: 'ROLEPLAY_CATALOGUE_HOME_API_KEY', keySource: 'env' }])
    const bad = new Sources(() => entry({ apiKeyRef: '1 bad' }), () => store)
    expect(() => bad.get('Home')).toThrow(/not a credential name/)
  })

  it('is stored, replaced and removed through the store, which may refuse', async () => {
    const store = memoryStore({}, ['FIXED'])
    const home = new Sources(() => entry(), () => store)
    expect(await home.keep('MY_KEY', 'v1')).toEqual({ ref: 'MY_KEY', configured: true, writable: true, source: 'file' })
    expect(store.values['MY_KEY']).toBe('v1')
    expect(await home.keep('MY_KEY', '')).toMatchObject({ configured: false })
    await expect(home.keep('FIXED', 'v')).rejects.toThrow(/launch environment/)
    await expect(home.keep('not valid', 'v')).rejects.toThrow(/not a credential name/)
  })

  it('cannot be kept in a profile that has no credential store, and a key in the configuration still works there', async () => {
    const bare = new Sources(() => entry({ apiKey: 'old' }))
    await expect(bare.keep('MY_KEY', 'v')).rejects.toThrow(/no credential store/)
    expect(await bare.key(bare.get('Home'))).toBe('old')
  })

  it('has a derived name that cannot be shared by two catalogues', () => {
    expect(catalogueKeyRef('Home')).toBe('ROLEPLAY_CATALOGUE_HOME_API_KEY')
    expect(catalogueKeyRef(' My site-2 ')).toBe('ROLEPLAY_CATALOGUE_MY_SITE_2_API_KEY')
    const chinese = [catalogueKeyRef('目录甲'), catalogueKeyRef('目录乙')]
    expect(new Set(chinese).size).toBe(2)
    for (const name of [...chinese, catalogueKeyRef('')]) expect(name).toMatch(/^[A-Za-z_][A-Za-z0-9_]*$/)
  })
})
