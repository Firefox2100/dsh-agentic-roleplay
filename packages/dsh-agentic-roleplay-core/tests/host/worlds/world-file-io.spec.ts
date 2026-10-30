import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { serialized, updateWorldFile } from '../../../src/host/worlds/world-file-io.ts'

let directory: string
beforeEach(async () => { directory = await mkdtemp(join(tmpdir(), 'world-io-')) })
afterEach(async () => { await rm(directory, { recursive: true, force: true }) })

const sleep = (ms: number): Promise<void> => new Promise((resolve) => { setTimeout(resolve, ms) })

describe('changing world.json', () => {
  it('keeps what each of several changes made, though they start together and are slow', async () => {
    await writeFile(join(directory, 'world.json'), '{\n    "id": "w",\n    "name": "N"\n}\n')
    await Promise.all(['a', 'b', 'c'].map(key => updateWorldFile(directory, async (document) => { await sleep(10); document[key] = key })))
    const text = await readFile(join(directory, 'world.json'), 'utf8')
    expect(JSON.parse(text)).toEqual({ id: 'w', name: 'N', a: 'a', b: 'b', c: 'c' })
    expect(text.startsWith('{\n    "id"')).toBe(true)
    expect(text.endsWith('\n')).toBe(true)
  })

  it('goes on with the next change after one that failed, and tells the failing one why', async () => {
    await writeFile(join(directory, 'world.json'), '{"id":"w"}')
    const failing = updateWorldFile(directory, () => { throw new Error('refused') })
    const next = updateWorldFile(directory, (document) => { document['x'] = 1 })
    await expect(failing).rejects.toThrow('refused')
    expect(await next).toEqual({ id: 'w', x: 1 })
  })

  it('runs work one after the other for one folder and side by side for two', async () => {
    const order: string[] = []
    await Promise.all([
      serialized('a', async () => { order.push('a1'); await sleep(20); order.push('a1 done') }),
      serialized('a', async () => { order.push('a2') }),
      serialized('b', async () => { order.push('b1') }),
    ])
    expect(order).toEqual(['a1', 'b1', 'a1 done', 'a2'])
  })
})
