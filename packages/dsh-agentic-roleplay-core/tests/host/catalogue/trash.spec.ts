import { mkdir, mkdtemp, readdir, rm, utimes } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { pruneTrash } from '../../../src/host/catalogue/trash.ts'

let root: string
const NOW = Date.parse('2026-11-30T12:00:00Z')
const day = 86_400_000

beforeEach(async () => { root = await mkdtemp(join(tmpdir(), 'trash-')) })
afterEach(async () => { await rm(root, { recursive: true, force: true }) })

const trashed = async (name: string): Promise<void> => { await mkdir(join(root, '.trash', 'worlds', name), { recursive: true }) }
const left = async (): Promise<string[]> => (await readdir(join(root, '.trash', 'worlds'))).sort()

describe('pruning what updates leave behind', () => {
  it('removes world files kept longer than the limit, by the time in their name, and nothing else', async () => {
    await trashed('harbor-2026-10-01T10-00-00-000Z')
    await trashed('harbor-2026-11-25T10-00-00-000Z')
    await trashed('somebody-elses-folder')
    const result = await pruneTrash(root, 30, NOW)
    expect(result).toEqual({ removed: ['.trash/worlds/harbor-2026-10-01T10-00-00-000Z'], failures: [] })
    expect(await left()).toEqual(['harbor-2026-11-25T10-00-00-000Z', 'somebody-elses-folder'])
  })

  it('keeps everything for good when the limit is 0', async () => {
    await trashed('harbor-2020-01-01T00-00-00-000Z')
    expect((await pruneTrash(root, 0, NOW)).removed).toEqual([])
    expect(await left()).toHaveLength(1)
  })

  it('removes the staging folder of an install that never finished, but not one in progress', async () => {
    await mkdir(join(root, '.install', 'old'), { recursive: true })
    await mkdir(join(root, '.install', 'fresh'), { recursive: true })
    await utimes(join(root, '.install', 'old'), new Date(NOW - 3 * day), new Date(NOW - 3 * day))
    await utimes(join(root, '.install', 'fresh'), new Date(NOW), new Date(NOW))
    expect((await pruneTrash(root, 30, NOW)).removed).toEqual(['.install/old'])
    expect(await readdir(join(root, '.install'))).toEqual(['fresh'])
  })

  it('does nothing when there is nothing there', async () => {
    expect(await pruneTrash(root, 30, NOW)).toEqual({ removed: [], failures: [] })
  })
})
