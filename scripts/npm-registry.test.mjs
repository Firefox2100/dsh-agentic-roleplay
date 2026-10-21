import assert from 'node:assert/strict'
import test from 'node:test'
import { isPublished } from './npm-registry.mjs'

test('checks the package metadata without invoking npm', async () => {
  let requested
  const request = async (url, options) => {
    requested = { url: String(url), options }
    return new Response(JSON.stringify({ versions: { '0.4.0': {} } }), { status: 200 })
  }
  assert.equal(await isPublished('@example/package', '0.4.0', request), true)
  assert.equal(requested.url, 'https://registry.npmjs.org/%40example%2Fpackage')
  assert.equal(requested.options.headers.accept, 'application/vnd.npm.install-v1+json')
})

test('treats a missing package as unpublished', async () => {
  assert.equal(await isPublished('missing', '1.0.0', async () => new Response(null, { status: 404 })), false)
})

test('reports registry failures', async () => {
  await assert.rejects(isPublished('broken', '1.0.0', async () => new Response(null, { status: 503, statusText: 'Unavailable' })), /503 Unavailable/)
})
