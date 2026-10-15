import assert from 'node:assert/strict'
import test from 'node:test'
import { parsePackOutput } from './pack-output.mjs'

test('reads a plain pnpm pack result', () => {
  assert.equal(parsePackOutput('{"name":"example","filename":"example.tgz"}\n').filename, 'example.tgz')
})

test('ignores prepack and postpack progress before the result', () => {
  const output = `. prepack$ node prepare.mjs
. prepack: Done
. postpack$ node clean.mjs
. postpack: Done
{
  "name": "example",
  "filename": "/tmp/example.tgz",
  "files": [{ "path": "LICENSE" }]
}
`
  assert.equal(parsePackOutput(output).filename, '/tmp/example.tgz')
})

test('refuses output without a usable result', () => {
  assert.throws(() => parsePackOutput('. prepack: Done\n{}\n'), /did not return/)
})
