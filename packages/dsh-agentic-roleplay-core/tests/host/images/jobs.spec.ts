import { mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { ImageGenerationService, type ImageGenerationResult } from 'dsh-ai-core'
import { createSessionStore, sessionDatabase } from 'dsh-roleplay-state'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ImageJobs } from '../../../src/host/images/jobs.ts'
import type { ImageAuthorJob } from '../../../src/host/images/author-agent.ts'
import { DEFAULT_SETTINGS } from '../../../src/shared/settings.ts'
import type { Timeline } from '../../../src/shared/timeline.ts'

const roots: string[] = []
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))) })

class Images extends ImageGenerationService {
  readonly provider = 'test'
  readonly model = 'paint'
  generate(): Promise<ImageGenerationResult> { throw new Error('the fake author does not call the provider') }
}

async function fixture(mode: 'off' | 'manual' | 'every-turn' = 'manual') {
  const directory = join(tmpdir(), `image-jobs-${process.pid}-${Date.now()}-${Math.random()}`)
  roots.push(directory)
  const id = '11111111-1111-4111-8111-111111111111'
  await mkdir(join(directory, id), { recursive: true })
  await writeFile(sessionDatabase(directory, id), '')
  const story = createSessionStore(':memory:', { id, name: 'S', world: { id: 'w', name: 'W' } })
  const output = { segments: [{ type: 'narration' as const, text: 'Rain crosses the empty street.' }], repaired: false }
  const timeline: Timeline = { version: 1, head: 'n1', next: 2, nodes: [{ id: 'n1', parent: null, turn: 3, userSeq: 1, createdAt: 'now', player: 'wait', output }] }
  let release: (() => void) | undefined
  const author = vi.fn((job: ImageAuthorJob) => new Promise<{ summary: string; images: string[] }>((resolve, reject) => {
    release = () => resolve({ summary: 'done', images: [] })
    job.signal.addEventListener('abort', () => { reject(job.signal.reason) }, { once: true })
  }))
  const jobs = new ImageJobs({
    state: { openSession: () => story } as never, sessionsDir: () => directory,
    timelines: { read: () => timeline } as never, service: () => new Images(), agentOf: () => ({}) as Agent,
    settings: () => ({ ...DEFAULT_SETTINGS, images: { ...DEFAULT_SETTINGS.images, mode } }), problem: vi.fn(), author,
  })
  return { id, output, author, jobs, release: () => { release?.() } }
}

describe('scene image jobs', () => {
  it('starts one manual job for a timeline node and exposes its state', async () => {
    const { id, author, jobs, release } = await fixture()
    expect(await jobs.generate(id, 'n1')).toMatchObject({ node: 'n1', mode: 'manual', state: 'generating' })
    expect(await jobs.generate(id, 'n1')).toMatchObject({ state: 'generating' })
    expect(author).toHaveBeenCalledTimes(1)
    expect(author.mock.calls[0]?.[0]).toMatchObject({ turn: 3, timelineNode: 'n1', purpose: 'transient', request: 'Rain crosses the empty street.' })
    release()
    await vi.waitFor(async () => { expect((await jobs.status(id, 'n1')).state).toBe('absent') })
  })

  it('runs automatically only in every-turn mode and cancels with the chat', async () => {
    const { id, output, author, jobs } = await fixture('every-turn')
    jobs.afterDelivery(`session-${id}`, 'n1', output)
    expect(author).toHaveBeenCalledTimes(1)
    const signal = author.mock.calls[0]![0].signal
    jobs.cancel(`session-${id}`)
    expect(signal.aborted).toBe(true)
  })

  it('refuses manual generation when illustrations are off', async () => {
    const { id, jobs } = await fixture('off')
    await expect(jobs.generate(id, 'n1')).rejects.toThrow(/disabled/)
  })
})
