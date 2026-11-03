import { mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { cachedJobs, forgetJobs } from '../../../src/host/import/job-cache.ts'
import type { ChildJob } from '../../../src/host/import/run.ts'

let directory: string
beforeEach(async () => { directory = await mkdtemp(join(tmpdir(), 'jobs-')) })
afterEach(async () => { await rm(directory, { recursive: true, force: true }) })

const job = (prompt: string, check?: (value: { n: number }) => string | undefined): ChildJob<{ n: number }> => ({ persona: 'p', prompt, result: { type: 'object', properties: {} } as never, ...check === undefined ? {} : { check } })

describe('the answers of finished jobs', () => {
  it('are kept, so a step run again asks only for the jobs that did not finish', async () => {
    const asked: string[] = []
    const run = cachedJobs(directory, async <T>(next: ChildJob<T>) => { asked.push(next.prompt); if (next.prompt === 'b' && asked.filter(entry => entry === 'b').length === 1) throw new Error('cut off'); return { n: asked.length } as T })
    await run(job('a'))
    await expect(run(job('b'))).rejects.toThrow('cut off')
    expect(await run(job('a'))).toEqual({ n: 1 })
    expect(await run(job('b'))).toEqual({ n: 3 })
    expect(asked).toEqual(['a', 'b', 'b'])
  })

  it('are asked for again when the check now refuses them, and are forgotten on request', async () => {
    let calls = 0
    const run = cachedJobs(directory, async <T>() => ({ n: (calls += 1) }) as T)
    await run(job('a'))
    expect(await run(job('a', value => (value.n < 2 ? 'too small' : undefined)))).toEqual({ n: 2 })
    await forgetJobs(directory)
    expect(await readdir(join(directory, '.import'))).toEqual([])
  })
})
