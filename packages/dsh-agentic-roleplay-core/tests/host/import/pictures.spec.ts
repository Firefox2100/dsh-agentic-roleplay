import { mkdir, readdir, rm } from 'node:fs/promises'
import { createServer, type Server } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { pictureHash } from '../../../src/host/images/library.ts'
import { withPngMetadata } from '../../../src/host/images/png-metadata.ts'
import { urlsOf } from '../../../src/host/import/card.ts'
import { addressesToFetch, candidateUrls, fetchPictures, isPublicAddress, mergeReports, requestOnce, vetUrl, type Fetcher, type Reply } from '../../../src/host/import/pictures.ts'

const PNG = Buffer.concat([Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64'), Buffer.alloc(2000)])
const OTHER = Buffer.concat([Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64'), Buffer.alloc(2000)])
const roots: string[] = []
const servers: Server[] = []
afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
  await Promise.all(servers.splice(0).map(server => new Promise(done => server.close(done))))
})

async function world(): Promise<string> {
  const directory = join(tmpdir(), `import-pictures-${process.pid}-${Date.now()}-${Math.random()}`)
  roots.push(directory)
  await mkdir(directory, { recursive: true })
  return directory
}

const reply = (extra: Partial<Reply>): Reply => ({ status: 200, type: '', location: undefined, body: Buffer.alloc(0), ...extra })

describe('addresses in a card', () => {
  it('are found in any string, scripts included, without markup or trailing punctuation', () => {
    expect(urlsOf({ a: 'see ![x](https://img.example/a.png) and <img src="http://img.example/b.jpg">.', nested: [{ s: 'fetch(`https://cdn.example/${name}.png`) https://cdn.example/c.webp,' }] })).toEqual([
      'https://img.example/a.png', 'http://img.example/b.jpg', 'https://cdn.example/c.webp',
    ])
  })

  it('keep the pictures and the ones with no file type, and drop the rest', () => {
    const { candidates, skipped } = candidateUrls([
      'https://a.example/x.png', 'https://a.example/x.png#again', 'https://a.example/share/abc123', 'https://a.example/app.js', 'https://a.example/v.svg',
      'ftp://a.example/x.png', 'https://u:p@a.example/x.png', 'https://a.example:8080/x.png', 'http://127.0.0.1/x.png', 'https://[::1]/x.png',
    ])
    expect(candidates).toEqual(['https://a.example/x.png', 'https://a.example/share/abc123'])
    expect(skipped.map(entry => entry.reason)).toEqual(['not an image', 'format not supported', 'not a web address', 'has credentials', 'uses an unusual port', 'is a private address', 'is a private address'])
  })
})

describe('which addresses may be connected to', () => {
  it('are public ones only', () => {
    for (const bad of ['127.0.0.1', '10.1.2.3', '172.16.0.1', '192.168.1.1', '169.254.169.254', '100.64.0.1', '0.0.0.0', '::1', 'fe80::1', 'fd00::1', '::ffff:127.0.0.1', '::ffff:7f00:1', '2002:7f00:1::', '64:ff9b::7f00:1']) expect(isPublicAddress(bad), bad).toBe(false)
    for (const good of ['8.8.8.8', '1.1.1.1', '2606:4700:4700::1111']) expect(isPublicAddress(good), good).toBe(true)
    expect(vetUrl('https://8.8.8.8/x.png')).toBeInstanceOf(URL)
  })

  it('are checked when connecting, so a name that resolves to this machine is refused', async () => {
    const server = createServer((_request, response) => { response.end('secret') })
    servers.push(server)
    await new Promise<void>(done => server.listen(0, '127.0.0.1', done))
    await expect(requestOnce(new URL('http://localhost/x.png'), 'GET', AbortSignal.timeout(5000))).rejects.toThrow(/not a public address/)
  })
})

describe('fetching the pictures of a card', () => {
  it('asks first, keeps what is a picture by its bytes and records why it left the rest', async () => {
    const directory = await world()
    const asked: string[] = []
    const fetcher: Fetcher = async (url, method) => {
      asked.push(`${method} ${url.pathname}`)
      if (url.pathname === '/page') return reply({ type: 'text/html' })
      if (url.pathname === '/gone.png') return reply({ status: 404 })
      if (url.pathname === '/liar.png') return method === 'HEAD' ? reply({ type: 'image/png' }) : reply({ type: 'image/png', body: Buffer.from('<html>'.repeat(400)) })
      if (url.pathname === '/nohead') return method === 'HEAD' ? reply({ status: 405 }) : reply({ type: 'binary/octet-stream', body: OTHER })
      if (url.pathname === '/moved.png') return reply({ status: 302, location: 'http://10.0.0.5/inner.png' })
      return method === 'HEAD' ? reply({ type: 'image/png' }) : reply({ type: 'image/png', body: PNG })
    }
    const report = await fetchPictures(directory, ['https://a.example/ok.png', 'https://a.example/copy.png', 'https://a.example/page', 'https://a.example/gone.png', 'https://a.example/liar.png', 'https://a.example/nohead', 'https://a.example/moved.png'], { fetcher, concurrency: 1 })
    expect(report.added.map(entry => entry.url)).toEqual(['https://a.example/ok.png', 'https://a.example/nohead'])
    expect(Object.fromEntries(report.skipped.map(entry => [entry.url.split('/').pop(), entry.reason]))).toEqual({
      'copy.png': 'a copy of another picture', page: 'not an image (text/html)', 'gone.png': 'gone', 'liar.png': 'not an image', 'moved.png': 'a redirect is a private address',
    })
    expect(asked).not.toContain('GET /page')
    expect(await readdir(join(directory, 'images', 'library'))).toHaveLength(2)
  })

  it('does not save a picture the library already holds, though the saved file carries our metadata', async () => {
    const directory = await world()
    const fetcher: Fetcher = async (_url, method) => method === 'HEAD' ? reply({ type: 'image/png' }) : reply({ type: 'image/png', body: PNG })
    const first = await fetchPictures(directory, ['https://a.example/one.png'], { fetcher })
    expect(first.added).toHaveLength(1)
    const again = await fetchPictures(directory, ['https://mirror.example/other-name.png'], { fetcher })
    expect(again.added).toEqual([])
    expect(again.skipped).toEqual([{ url: 'https://mirror.example/other-name.png', reason: 'a copy of another picture', of: first.added[0]!.path }])
    expect(await readdir(join(directory, 'images', 'library'))).toHaveLength(1)
  })
})

describe('what a newer card asks for again', () => {
  it('hashes a PNG by its picture: metadata chunks do not change it, other pictures do', () => {
    const tagged = withPngMetadata(PNG, { schema: 'x', note: 'written after saving' })
    expect(tagged.equals(PNG)).toBe(false)
    expect(pictureHash(tagged)).toBe(pictureHash(PNG))
    expect(pictureHash(OTHER)).not.toBe(pictureHash(PNG))
    expect(pictureHash(Buffer.from('\xff\xd8\xffnot really', 'latin1'))).toHaveLength(64)
  })

  const record = { found: 3, added: [{ url: 'https://a.example/ok.png', path: 'library/ok.png' }], skipped: [{ url: 'https://a.example/down.png', reason: 'timed out' }, { url: 'https://a.example/page', reason: 'not an image (text/html)' }, { url: 'https://a.example/err.png', reason: 'answered 503' }, { url: 'https://a.example/no.png', reason: 'answered 403' }] }
  const all = [...record.added.map(entry => entry.url), ...record.skipped.map(entry => entry.url)]

  it('is the new addresses and the ones that failed for a reason that may pass', () => {
    expect(addressesToFetch(all, [...all, 'https://b.example/new.png'], record)).toEqual(['https://a.example/down.png', 'https://a.example/err.png', 'https://b.example/new.png'])
  })

  it('is only the new addresses when there is no record, so what the person removed stays removed', () => {
    expect(addressesToFetch(all, [...all, 'https://b.example/new.png'], undefined)).toEqual(['https://b.example/new.png'])
  })

  it('replaces the answer of an address asked again and keeps the rest', () => {
    const merged = mergeReports(record, { found: 2, added: [{ url: 'https://a.example/down.png', path: 'library/down.png' }], skipped: [{ url: 'https://a.example/err.png', reason: 'answered 503' }] }, 5)
    expect(merged.found).toBe(5)
    expect(merged.added.map(entry => entry.url)).toEqual(['https://a.example/ok.png', 'https://a.example/down.png'])
    expect(merged.skipped.map(entry => entry.url)).toEqual(['https://a.example/page', 'https://a.example/no.png', 'https://a.example/err.png'])
  })
})
