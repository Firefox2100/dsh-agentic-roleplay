import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { CheckpointNotFoundError, diffCheckpoint, lastRestore, listCheckpoints, makeCheckpoint, readCheckpointFile, restoreCheckpoint } from '../../../src/host/worlds/checkpoints.ts'

let world: string
const write = async (path: string, text: string) => { await mkdir(join(world, path, '..'), { recursive: true }); await writeFile(join(world, path), text) }
const read = (path: string) => readFile(join(world, path), 'utf8')
const request = { label: 'edit', reason: 'turn' as const, keep: 30 }

beforeEach(async () => {
  world = await mkdtemp(join(tmpdir(), 'checkpoints-'))
  await write('world.json', '{"id":"w1","name":"Harbour"}')
  await write('characters/tam/character.json', '{"name":"Tam"}')
  await write('locations/pier/location.json', '{"name":"Pier"}')
  await write('images/library/a.png', 'png')
  await write('media/cover.png', 'cover')
  await write('.import/state.json', '{"phase":"done"}')
})
afterEach(async () => { await rm(world, { recursive: true, force: true }) })

describe('a checkpoint of a world', () => {
  it('keeps the authored files and leaves out the pictures and every dot folder', async () => {
    const { checkpoint, made } = await makeCheckpoint(world, request)
    expect(made).toBe(true)
    expect(checkpoint).toMatchObject({ reason: 'turn', files: 3 })
    expect((await diffCheckpoint(world, checkpoint.id))).toEqual({ changed: [], added: [], removed: [] })
    await expect(readCheckpointFile(world, checkpoint.id, 'images/library/a.png')).rejects.toThrow(CheckpointNotFoundError)
    await expect(readCheckpointFile(world, checkpoint.id, '.import/state.json')).rejects.toThrow(CheckpointNotFoundError)
    expect(await readCheckpointFile(world, checkpoint.id, 'characters/tam/character.json')).toMatchObject({ text: '{"name":"Tam"}', truncated: false })
  })

  it('is not made again while nothing changed, except when asked for', async () => {
    const first = await makeCheckpoint(world, request)
    const again = await makeCheckpoint(world, request)
    expect(again).toMatchObject({ made: false, checkpoint: { id: first.checkpoint.id } })
    const manual = await makeCheckpoint(world, { ...request, reason: 'manual', label: 'by hand' })
    expect(manual.made).toBe(true)
    expect(await listCheckpoints(world)).toHaveLength(2)
    await write('world.json', '{"id":"w1","name":"Other"}')
    expect((await makeCheckpoint(world, request)).made).toBe(true)
  })

  it('lists newest first, and keeps only the newest ones', async () => {
    for (let n = 0; n < 4; n += 1) { await write('world.json', `{"id":"w1","name":"v${n}"}`); await makeCheckpoint(world, { ...request, label: `v${n}`, keep: 3 }) }
    const all = await listCheckpoints(world)
    expect(all.map(each => each.label)).toEqual(['v3', 'v2', 'v1'])
  })

  it('says what changed since: edited, added and removed files', async () => {
    const { checkpoint } = await makeCheckpoint(world, request)
    await write('characters/tam/character.json', '{"name":"Old Tam"}')
    await write('characters/mara/character.json', '{"name":"Mara"}')
    await rm(join(world, 'locations'), { recursive: true })
    expect(await diffCheckpoint(world, checkpoint.id)).toEqual({ changed: ['characters/tam/character.json'], added: ['characters/mara/character.json'], removed: ['locations/pier/location.json'] })
  })

  it('reads only files it holds, never a way out of the folder, and refuses ids it did not make', async () => {
    const { checkpoint } = await makeCheckpoint(world, request)
    await expect(readCheckpointFile(world, checkpoint.id, '../world.json')).rejects.toThrow(CheckpointNotFoundError)
    await expect(readCheckpointFile(world, checkpoint.id, '/etc/passwd')).rejects.toThrow(CheckpointNotFoundError)
    await expect(readCheckpointFile(world, '../x', 'world.json')).rejects.toThrow(CheckpointNotFoundError)
    await expect(diffCheckpoint(world, '20200101T000000000Z-abcd')).rejects.toThrow(CheckpointNotFoundError)
  })

  it('cuts a long file when it is read back, and says so', async () => {
    await write('lore/x/lore.json', 'x'.repeat(30_000))
    const { checkpoint } = await makeCheckpoint(world, request)
    const file = await readCheckpointFile(world, checkpoint.id, 'lore/x/lore.json')
    expect(file).toMatchObject({ truncated: true, of: 30_000 })
    expect(file.text).toHaveLength(20_000)
  })
})

describe('restoring a checkpoint', () => {
  it('puts the files back as they were, keeps the pictures and the import records, and keeps what was there in the trash and as a checkpoint', async () => {
    const { checkpoint } = await makeCheckpoint(world, request)
    await write('characters/tam/character.json', '{"name":"Old Tam"}')
    await write('characters/mara/character.json', '{"name":"Mara"}')
    await rm(join(world, 'locations'), { recursive: true })
    const { restored, before } = await restoreCheckpoint(world, checkpoint.id, 30)
    expect(restored.id).toBe(checkpoint.id)
    expect(before).toMatchObject({ reason: 'before-restore' })
    expect(await read('characters/tam/character.json')).toBe('{"name":"Tam"}')
    expect(await read('locations/pier/location.json')).toBe('{"name":"Pier"}')
    await expect(read('characters/mara/character.json')).rejects.toThrow()
    expect(await read('images/library/a.png')).toBe('png')
    expect(await read('.import/state.json')).toContain('done')
    expect(await readdir(join(world, '.trash'))).toHaveLength(1)
    expect(await lastRestore(world)).toMatchObject({ checkpoint: checkpoint.id })
    // the restore itself can be undone
    await restoreCheckpoint(world, before!.id, 30)
    expect(await read('characters/mara/character.json')).toBe('{"name":"Mara"}')
  })

  it('leaves the world as it was when a checkpoint is incomplete', async () => {
    const { checkpoint } = await makeCheckpoint(world, request)
    await rm(join(world, '.checkpoints', checkpoint.id, 'files', 'world.json'))
    await write('world.json', '{"id":"w1","name":"Edited"}')
    await expect(restoreCheckpoint(world, checkpoint.id, 30)).rejects.toThrow(/incomplete/)
    expect(await read('world.json')).toContain('Edited')
  })

  it('refuses a checkpoint that does not exist', async () => {
    await expect(restoreCheckpoint(world, '20200101T000000000Z-abcd', 30)).rejects.toThrow(CheckpointNotFoundError)
  })

  it('still keeps only the configured number after saving the pre-restore state', async () => {
    const first = await makeCheckpoint(world, { ...request, label: 'first', keep: 2 })
    await write('world.json', '{"id":"w1","name":"Second"}')
    await makeCheckpoint(world, { ...request, label: 'second', keep: 2 })
    await write('world.json', '{"id":"w1","name":"Third"}')
    await restoreCheckpoint(world, first.checkpoint.id, 2)
    expect(await listCheckpoints(world)).toHaveLength(2)
  })
})
