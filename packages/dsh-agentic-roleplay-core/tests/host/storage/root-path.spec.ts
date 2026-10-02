import { mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { ROOT_LAYOUT, ensureRootLayout, resolveRootPath } from '../../../src/host/storage/root-path.ts'

describe('resolveRootPath', () => {
  it('expands a leading tilde', () => {
    expect(resolveRootPath('~/rp', '/home/u')).toBe('/home/u/rp')
    expect(resolveRootPath('~', '/home/u')).toBe('/home/u')
  })

  it('normalizes absolute paths and trims whitespace', () => {
    expect(resolveRootPath('  /data/rp/../roleplay/ ', '/home/u')).toBe('/data/roleplay/')
  })

  it('rejects blank and relative paths', () => {
    expect(() => resolveRootPath('   ', '/home/u')).toThrow('empty')
    expect(() => resolveRootPath('rp/data', '/home/u')).toThrow('absolute')
    expect(() => resolveRootPath('~other/rp', '/home/u')).toThrow('absolute')
  })
})

describe('ensureRootLayout', () => {
  let dir: string | undefined

  afterEach(async () => {
    if (dir !== undefined) await rm(dir, { recursive: true, force: true })
    dir = undefined
  })

  it('creates the root with its baseline directories and is idempotent', async () => {
    dir = await mkdtemp(join(tmpdir(), 'roleplay-'))
    const root = join(dir, 'nested', 'root')
    await ensureRootLayout(root)
    await ensureRootLayout(root)
    expect((await readdir(root)).sort()).toEqual([...ROOT_LAYOUT].sort())
  })
})
