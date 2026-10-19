import { describe, expect, it } from 'vitest'
import { parseBase, Sources } from '../../../src/host/catalogue/sources.ts'

const sources = new Sources(() => [
  { name: 'Home', baseUrl: 'http://localhost:9798/', apiKey: 'home-key' },
  { name: 'Site API', baseUrl: 'https://cat.example/api', apiKey: 'api-key' },
  { name: 'Site', baseUrl: 'https://cat.example', apiKey: '' },
  { name: 'Home', baseUrl: 'https://other.example', apiKey: '' },
  { name: 'Broken', baseUrl: 'ftp://x', apiKey: '' },
  { name: ' ', baseUrl: 'https://blank.example', apiKey: '' },
])

describe('the configured catalogues', () => {
  it('say which can be used, which have a key, and why the others cannot', () => {
    expect(sources.status()).toEqual([
      { name: 'Home', baseUrl: 'http://localhost:9798/', hasKey: true },
      { name: 'Site API', baseUrl: 'https://cat.example/api', hasKey: true },
      { name: 'Site', baseUrl: 'https://cat.example', hasKey: false },
      { name: 'Home', baseUrl: 'https://other.example', hasKey: false, problem: 'repeats the name of an earlier catalogue' },
      { name: 'Broken', baseUrl: 'ftp://x', hasKey: false, problem: 'address is not a web address' },
      { name: '', baseUrl: 'https://blank.example', hasKey: false, problem: 'has no name' },
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
