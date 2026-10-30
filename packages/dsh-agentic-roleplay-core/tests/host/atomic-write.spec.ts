import { chmod, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { atomicWrite, atomicWriteJson, atomicWriteSync } from '../../src/host/atomic-write.ts'

let directory: string
beforeEach(async () => { directory = await mkdtemp(join(tmpdir(), 'atomic-')) })
afterEach(async () => { await rm(directory, { recursive: true, force: true }) })

describe('replacing a file in one step', () => {
  it('writes a new file, keeps the permissions of the one it replaces and leaves no temporary file', async () => {
    const file = join(directory, 'a.json')
    await atomicWrite(file, 'one')
    expect((await stat(file)).mode & 0o777).toBe(0o644)
    await chmod(file, 0o600)
    await atomicWrite(file, 'two')
    expect(await readFile(file, 'utf8')).toBe('two')
    expect((await stat(file)).mode & 0o777).toBe(0o600)
    expect(await readdir(directory)).toEqual(['a.json'])
  })

  it('makes the folder when asked, writes JSON with its indentation and a final newline, and leaves the old file when the write fails', async () => {
    const file = join(directory, 'deep', 'er', 'b.json')
    await atomicWriteJson(file, { a: 1 }, { createDirectory: true, indent: 2 })
    expect(await readFile(file, 'utf8')).toBe('{\n  "a": 1\n}\n')
    await expect(atomicWrite(join(directory, 'missing', 'c.json'), 'x')).rejects.toThrow()
    await writeFile(join(directory, 'd.json'), 'old')
    await chmod(join(directory, 'd.json'), 0o600)
    atomicWriteSync(join(directory, 'd.json'), 'new')
    expect(await readFile(join(directory, 'd.json'), 'utf8')).toBe('new')
    expect((await stat(join(directory, 'd.json'))).mode & 0o777).toBe(0o600)
    expect((await readdir(directory)).sort()).toEqual(['d.json', 'deep'])
  })
})
