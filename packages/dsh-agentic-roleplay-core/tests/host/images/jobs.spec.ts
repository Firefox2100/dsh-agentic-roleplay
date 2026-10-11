import { mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { ImageGenerationService, type ImageGenerationResult } from 'dsh-ai-core'
import { createSessionStore, sessionDatabase } from 'dsh-roleplay-state'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { addToLibrary } from '../../../src/host/images/library.ts'
import { present } from '../../../src/host/images/presented.ts'
import { updateImage } from '../../../src/host/images/gallery.ts'
import { ImageJobs } from '../../../src/host/images/jobs.ts'
import type { ImagePresenterJob } from '../../../src/host/images/presenter-agent.ts'
import { DEFAULT_SETTINGS } from '../../../src/shared/settings.ts'
import type { Timeline } from '../../../src/shared/timeline.ts'

const roots: string[] = []
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))) })

class Images extends ImageGenerationService {
  readonly provider = 'test'
  readonly model = 'paint'
  generate(): Promise<ImageGenerationResult> { throw new Error('the fake author does not call the provider') }
}

async function fixture(mode: 'off' | 'manual' | 'every-turn' = 'manual', extra: Partial<ConstructorParameters<typeof ImageJobs>[0]> = {}) {
  const directory = join(tmpdir(), `image-jobs-${process.pid}-${Date.now()}-${Math.random()}`)
  roots.push(directory)
  const id = '11111111-1111-4111-8111-111111111111'
  await mkdir(join(directory, id), { recursive: true })
  await writeFile(sessionDatabase(directory, id), '')
  const story = createSessionStore(':memory:', { id, name: 'S', world: { id: 'w', name: 'W' } })
  const output = { segments: [{ type: 'narration' as const, text: 'Rain crosses the empty street.' }], repaired: false }
  const timeline: Timeline = { version: 1, head: 'n1', next: 2, nodes: [{ id: 'n1', parent: null, turn: 3, userSeq: 1, createdAt: 'now', player: 'wait', output }] }
  let release: (() => void) | undefined
  const author = vi.fn((job: ImagePresenterJob) => new Promise<{ summary: string; images: string[] }>((resolve, reject) => {
    release = () => resolve({ summary: 'done', images: [] })
    job.signal.addEventListener('abort', () => { reject(job.signal.reason) }, { once: true })
  }))
  const jobs = new ImageJobs({
    state: { openSession: () => story } as never, sessionsDir: () => directory,
    timelines: { read: () => timeline } as never, service: () => new Images(), agentOf: () => ({}) as Agent,
    settings: () => ({ ...DEFAULT_SETTINGS, images: { ...DEFAULT_SETTINGS.images, mode } }), problem: vi.fn(), presenter: author, ...extra,
  })
  return { id, directory, output, author, jobs, release: () => { release?.() } }
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

  it('asks the provider for what the player requested ahead of what a turn started on its own', async () => {
    const manual = await fixture()
    await manual.jobs.generate(manual.id, 'n1')
    const automatic = await fixture('every-turn')
    automatic.jobs.afterDelivery(`session-${automatic.id}`, 'n1', automatic.output)
    const seen: unknown[] = []
    const record = (author: typeof manual.author) => {
      const service = author.mock.calls[0]![0].service as unknown as { generate(prompt: string, options?: object): unknown }
      return service
    }
    for (const fixtureOf of [manual, automatic]) {
      const service = record(fixtureOf.author)
      Object.getPrototypeOf(service).generate = (_prompt: string, options: object) => { seen.push(options); return Promise.resolve({}) }
    }
    expect(seen).toEqual([])
    await (record(manual.author) as { generate(prompt: string): Promise<unknown> }).generate('p')
    await (record(automatic.author) as { generate(prompt: string): Promise<unknown> }).generate('p')
    expect(seen).toEqual([{ priority: 'foreground' }, { priority: 'background' }])
  })

  it('refuses manual generation when illustrations are off', async () => {
    const { id, jobs } = await fixture('off')
    await expect(jobs.generate(id, 'n1')).rejects.toThrow(/disabled/)
  })
})

describe('pictures the person brings', () => {
  const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64')

  it('are described in the background once added, and stay as they were when no model can read them', async () => {
    const interpret = vi.fn(async (job: { sessionFolder: string; path: string }) => updateImage(job.sessionFolder, job.path, { description: 'A foggy dock.' }))
    const { id, jobs } = await fixture('manual', { attachments: () => ({ saveImage: vi.fn() }) as never, interpret: interpret as never })
    const path = await jobs.upload(id, 'dock.png', PNG)
    await jobs.describePending(id, new AbortController().signal)
    expect(interpret).toHaveBeenCalledTimes(1)
    expect((await jobs.gallery(id)).images.find(image => image.path === path)).toMatchObject({ description: 'A foggy dock.', reusable: true })

    const without = await fixture('manual')
    const other = await without.jobs.upload(without.id, 'dock.png', PNG)
    await without.jobs.describePending(without.id, new AbortController().signal)
    expect((await without.jobs.gallery(without.id)).images.find(image => image.path === other)).toMatchObject({ pending: true })
  })

  it('that fail to be described are listed with the reason and tried again by the next run', async () => {
    let fail = true
    const interpret = vi.fn(async (job: { sessionFolder: string; path: string }) => { if (fail) throw new Error('the model cannot read images'); return updateImage(job.sessionFolder, job.path, { description: 'ok' }) })
    const { id, jobs } = await fixture('manual', { attachments: () => ({}) as never, interpret: interpret as never })
    const path = await jobs.upload(id, 'a.png', PNG)
    await jobs.describePending(id, new AbortController().signal)
    expect((await jobs.gallery(id)).failures).toEqual({ [path]: 'the model cannot read images' })
    fail = false
    await jobs.describePending(id, new AbortController().signal)
    const after = await jobs.gallery(id)
    expect(after.failures).toEqual({})
    expect(after.images[0]?.description).toBe('ok')
  })

  it('make an automatic picture look in the library first, and a requested one never', async () => {
    const automatic = await fixture('every-turn')
    automatic.jobs.afterDelivery(`session-${automatic.id}`, 'n1', automatic.output)
    expect(automatic.author.mock.calls[0]![0]).toMatchObject({ reuse: true })
    const requested = await fixture('manual')
    await requested.jobs.generate(requested.id, 'n1')
    expect(requested.author.mock.calls[0]![0]).toMatchObject({ reuse: false })
    const off = await fixture('every-turn')
    ;(off.jobs as unknown as { deps: { settings: () => unknown } }).deps.settings = () => ({ ...DEFAULT_SETTINGS, images: { ...DEFAULT_SETTINGS.images, mode: 'every-turn', reuse: false } })
    off.jobs.afterDelivery(`session-${off.id}`, 'n1', off.output)
    expect(off.author.mock.calls[0]![0]).toMatchObject({ reuse: false })
  })

  it('show an existing image for a turn in its status', async () => {
    const { id, directory, jobs } = await fixture('manual')
    const path = await addToLibrary(join(directory, id), PNG, 'a.png')
    await updateImage(join(directory, id), path, { description: 'A dock.' })
    await present(join(directory, id), 'n1', { path, reason: 'same dock' })
    expect(await jobs.status(id, 'n1')).toMatchObject({ state: 'ready', images: [{ serial: 1, existing: true, details: { path, description: 'A dock.' } }] })
  })
})
