import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'

const script = path.join(path.dirname(fileURLToPath(import.meta.url)), 'merge-coverage.mjs')

async function workspace() {
  const root = await mkdtemp(path.join(tmpdir(), 'merge-coverage-'))
  await mkdir(path.join(root, 'scripts'))
  await cp(script, path.join(root, 'scripts', 'merge-coverage.mjs'))
  return root
}

const run = root => execFileSync(process.execPath, [path.join(root, 'scripts', 'merge-coverage.mjs')], { stdio: 'pipe' })

test('merges package reports with sources relative to the repository root', async () => {
  const root = await workspace()
  try {
    for (const name of ['alpha', 'beta']) {
      await mkdir(path.join(root, 'packages', name, 'coverage'), { recursive: true })
      await writeFile(path.join(root, 'packages', name, 'coverage', 'lcov.info'), `TN:\nSF:src/${name}.ts\nend_of_record\n`)
    }
    await mkdir(path.join(root, 'packages', 'gamma'), { recursive: true })
    run(root)
    const merged = await readFile(path.join(root, 'coverage', 'lcov.info'), 'utf8')
    assert.match(merged, /^SF:packages\/alpha\/src\/alpha\.ts$/m)
    assert.match(merged, /^SF:packages\/beta\/src\/beta\.ts$/m)
    assert.doesNotMatch(merged, /gamma/)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('fails when no package produced a report', async () => {
  const root = await workspace()
  try {
    await mkdir(path.join(root, 'packages', 'alpha'), { recursive: true })
    assert.throws(() => run(root), /No LCOV reports were found/)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
