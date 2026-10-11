import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { addAvatarsToWorld, adaptAvatar, avatarsWorld, createAvatar, deleteAvatar } from '../../../src/host/avatars/avatars.ts'
import { referenceImagePath } from '../../../src/host/images/storage.ts'
import { readWorldEditor } from '../../../src/host/worlds/world-editor.ts'

let root: string
beforeEach(async () => { root = await mkdtemp(join(tmpdir(), 'avatars-')) })
afterEach(async () => { await rm(root, { recursive: true, force: true }) })

async function write(path: string, content: unknown): Promise<void> {
  await mkdir(join(path, '..'), { recursive: true })
  await writeFile(path, typeof content === 'string' ? content : JSON.stringify(content))
}

describe('player avatars', () => {
  it('makes a playable avatar from a name with a key of its own, and reads as a cast of one world', async () => {
    const avatars = await avatarsWorld(root)
    expect(await createAvatar(avatars, 'Mira Vale')).toBe('mira-vale')
    expect(await createAvatar(avatars, 'Mira Vale')).toBe('mira-vale-2')
    expect(await createAvatar(avatars, '林晚')).toBe('林晚')
    const state = await readWorldEditor(avatars)
    expect(state.characters.map(character => [character.key, character.role])).toEqual([['mira-vale', 'playable'], ['mira-vale-2', 'playable'], ['林晚', 'playable']])
    await expect(createAvatar(avatars, '  ')).rejects.toThrow('needs a name')
  })

  it('deletes into the trash', async () => {
    const avatars = await avatarsWorld(root)
    await createAvatar(avatars, 'Mira')
    await deleteAvatar(avatars, 'mira')
    expect((await readWorldEditor(avatars)).characters).toEqual([])
    expect(existsSync(join(avatars.directory, '.trash', 'characters'))).toBe(true)
  })

  it('adapts a document to a world: playable, what points into another world dropped, relationships kept for those who are there', () => {
    const adapted = adaptAvatar({
      id: 'mira', name: 'Mira', role: 'npc', knowledge: { locations: ['x'] }, routine: [{}], variables: { luck: 3 },
      relationships: [{ to: 'ana', label: 'friend' }, { to: 'gone', label: 'foe' }, { to: 'mira', label: 'self' }],
      start: { public_state: 'Calm.', location: 'old', position: 'by the door', intents: [{ name: 'Look' }] },
    }, 'mira-2', { known: new Set(['ana']), place: { location: 'dock' } })
    expect(adapted).toEqual({
      id: 'mira-2', name: 'Mira', role: 'playable', relationships: [{ to: 'ana', label: 'friend' }],
      start: { public_state: 'Calm.', location: 'dock', intents: [{ name: 'Look' }] },
    })
  })

  it('adds avatars to a world as characters, with a unique id, the portrait and the place of its playable characters', async () => {
    const avatars = await avatarsWorld(root)
    await createAvatar(avatars, 'Ana')
    await createAvatar(avatars, 'Mira')
    const portrait = referenceImagePath(avatars.directory, { kind: 'character', localId: 'mira' })
    await write(portrait, 'png')
    const world = { id: 'w', directory: join(root, 'worlds', 'w') }
    await write(join(world.directory, 'world.json'), { id: 'w', name: 'W' })
    await write(join(world.directory, 'locations', 'dock', 'location.json'), { name: 'Dock' })
    await write(join(world.directory, 'locations', 'pier', 'location.json'), { name: 'Pier' })
    await write(join(world.directory, 'characters', 'ana', 'character.json'), { name: 'Old Ana', role: 'playable', start: { location: 'pier' } })
    const { loadLocations } = await import('../../../src/host/locations/load.ts')
    const added = await addAvatarsToWorld(avatars, world, ['ana', 'mira'], (await loadLocations(world.directory)).locations)
    expect(added).toEqual(['ana-2', 'mira'])
    const state = await readWorldEditor(world)
    expect(state.characters.map(character => [character.key, character.role, character.place?.key])).toEqual([['ana', 'playable', 'pier'], ['ana-2', 'playable', 'pier'], ['mira', 'playable', 'pier']])
    expect(await readFile(referenceImagePath(world.directory, { kind: 'character', localId: 'mira' }), 'utf8')).toBe('png')
    await expect(addAvatarsToWorld(avatars, world, ['nobody'], [])).rejects.toThrow('no character "nobody"')
  })
})
