import { describe, expect, it } from 'vitest'
import { SerialQueue } from '../../src/host/serial.ts'

/** A promise resolved by hand, to decide when a job finishes. */
function gate(): { promise: Promise<void>; open: () => void } {
  let open!: () => void
  const promise = new Promise<void>((resolve) => {
    open = resolve
  })
  return { promise, open }
}

describe('one job at a time per key', () => {
  it('runs the jobs of a key in the order they were asked for, never side by side', async () => {
    const queue = new SerialQueue()
    const log: string[] = []
    const first = gate()
    const a = queue.run('chat', async () => {
      log.push('a in')
      await first.promise
      log.push('a out')
    })
    const b = queue.run('chat', async () => {
      log.push('b in')
    })
    await Promise.resolve()
    expect(log).toEqual(['a in'])
    first.open()
    await Promise.all([a, b])
    expect(log).toEqual(['a in', 'a out', 'b in'])
  })

  it('keeps going after a job fails, and only the caller of the failed job is told', async () => {
    const queue = new SerialQueue()
    const failed = queue.run('chat', async () => {
      throw new Error('the first run broke')
    })
    const next = queue.run('chat', async () => 'second')
    await expect(failed).rejects.toThrow('the first run broke')
    await expect(next).resolves.toBe('second')
  })

  it('forgets a key once nothing is waiting for it', async () => {
    const queue = new SerialQueue()
    const held = gate()
    const running = queue.run('one', () => held.promise)
    await Promise.resolve()
    expect(queue.pending).toBe(1)
    held.open()
    await running
    await expect.poll(() => queue.pending).toBe(0)
  })

  it('runs different keys side by side', async () => {
    const queue = new SerialQueue()
    const both = gate()
    const started: string[] = []
    const one = queue.run('one', async () => {
      started.push('one')
      await both.promise
    })
    const two = queue.run('two', async () => {
      started.push('two')
      await both.promise
    })
    await expect.poll(() => started.length).toBe(2)
    both.open()
    await Promise.all([one, two])
  })
})
