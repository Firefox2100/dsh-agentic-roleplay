import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ImageGenerationService, type ImageGenerationResult } from 'dsh-ai-core'
import { editWorldCharacter, editWorldFaction, editWorldNarrationVoice, editWorldPlace, editWorldRelation, editWorldThing, generateWorldCharacterPortrait, readWorldEditor } from '../../../src/host/worlds/world-editor.ts'
import { InvalidEditProblems } from '../../../src/shared/world-state.ts'

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64')

class Images extends ImageGenerationService {
  readonly provider = 'test'
  readonly model = 'paint-1'
  async generate(): Promise<ImageGenerationResult> {
    return { model: this.model, images: [{ data: new Blob([PNG], { type: 'image/png' }), mediaType: 'image/png' }] }
  }
}

let world: { id: string; directory: string }
const fileOf = (folder: string) => join(world.directory, 'characters', folder, 'character.json')
const write = async (path: string, value: unknown) => { await mkdir(join(path, '..'), { recursive: true }); await writeFile(path, `${JSON.stringify(value, null, 4)}\n`) }
const read = async (folder: string) => JSON.parse(await readFile(fileOf(folder), 'utf8')) as Record<string, unknown>

beforeEach(async () => {
  world = { id: 'test-world', directory: await mkdtemp(join(tmpdir(), 'world-editor-')) }
  await write(join(world.directory, 'world.json'), { id: world.id, name: 'Test World' })
  await write(join(world.directory, 'locations', 'bar', 'location.json'), { name: 'The Bar', exits: [{ to: 'cellar', description: 'stairs', travel_time_seconds: 20 }] })
  await write(join(world.directory, 'locations', 'cellar', 'location.json'), { name: 'The Cellar' })
  await write(join(world.directory, 'items', 'ledger', 'item.json'), { name: 'Ledger', location: 'bar' })
  await write(join(world.directory, 'factions', 'watch', 'faction.json'), { name: 'The Watch', values: ['order'], start: { public_state: 'Patrolling.' }, members: [{ character: 'clara', role: 'informant' }] })
  await write(fileOf('clara'), {
    name: 'Clara', role: 'npc', age: 41, summary: 'Innkeeper.', extra_field: { kept: true },
    start: { public_state: 'Wiping glasses', location: 'bar', feature: 'counter', intents: [{ name: 'Find the ledger', priority: 0.8, plan: ['ask around'] }] }, relationships: [{ to: 'arthur', label: 'guest', familiarity: 0.2 }], knowledge: { locations: ['bar'] },
  })
  await write(fileOf('arthur'), { name: 'Arthur', role: 'playable' })
})
afterEach(async () => { await rm(world.directory, { recursive: true, force: true }) })

describe('a world in the editor', () => {
  it('is its characters as they start, and the places they can start in', async () => {
    const state = await readWorldEditor(world)
    expect(state.places).toEqual([{ key: 'bar', name: 'The Bar', description: '', features: [] }, { key: 'cellar', name: 'The Cellar', description: '', features: [] }])
    expect(state.characters.map(character => [character.key, character.control])).toEqual([['arthur', 'player'], ['clara', 'agent']])
    expect(state.characters[1]).toMatchObject({ age: '41', place: { key: 'bar', name: 'The Bar' }, state: { publicState: 'Wiping glasses' }, goals: [{ ref: '0', name: 'Find the ledger', priority: 0.8 }] })
  })

  it('stores the narrator voice in the world file', async () => {
    const state = await editWorldNarrationVoice(world, ' narrator-1 ')
    expect(state.narrationVoice).toBe('narrator-1')
    expect(JSON.parse(await readFile(join(world.directory, 'world.json'), 'utf8')).narration_voice).toBe('narrator-1')
  })

  it('changes the file as a whole and keeps what the editor does not know, the order and the indentation; an optional field left blank leaves the file', async () => {
    const state = await editWorldCharacter(world, 'clara', {
      name: 'Clara Whitlock', age: ' ', pronouns: 'she/her', speech: { style: 'Brisk', examples: ['Evening.'] }, state: { activity: 'serving' },
      place: { location: 'cellar', position: 'by the barrels' }, goals: [{ ref: '0', status: 'paused', description: 'Where did it go?' }],
    })
    const file = await read('clara')
    expect(file).toMatchObject({ name: 'Clara Whitlock', pronouns: 'she/her', extra_field: { kept: true }, summary: 'Innkeeper.', speech: { style: 'Brisk', examples: ['Evening.'] } })
    expect(file).not.toHaveProperty('age')
    expect(file['start']).toEqual({ public_state: 'Wiping glasses', location: 'cellar', position: 'by the barrels', activity: 'serving', intents: [{ name: 'Find the ledger', priority: 0.8, plan: ['ask around'], status: 'paused', description: 'Where did it go?' }] })
    expect(Object.keys(file).slice(0, 4)).toEqual(['name', 'role', 'summary', 'extra_field'])
    expect((await readFile(fileOf('clara'), 'utf8')).startsWith('{\n    "name"')).toBe(true)
    expect(state.characters.find(character => character.key === 'clara')).toMatchObject({ name: 'Clara Whitlock', place: { key: 'cellar', position: 'by the barrels' } })
  })

  it('refuses what would not be a valid character or points nowhere, with the reasons, and leaves the file as it was', async () => {
    const before = await readFile(fileOf('arthur'), 'utf8')
    const problems = async (key: string, edit: Parameters<typeof editWorldCharacter>[2]): Promise<string[]> => {
      try { await editWorldCharacter(world, key, edit); return [] } catch (error) { if (error instanceof InvalidEditProblems) return [...error.problems]; throw error }
    }
    expect(await problems('nobody', { name: 'x' })).toEqual(['there is no character "nobody"'])
    expect(await problems('arthur', { place: { location: 'moon' } })).toEqual(['there is no place "moon"'])
    expect(await problems('arthur', { kind: 'group' })).toEqual([expect.stringContaining('a playable character must be a person')])
    expect(await problems('arthur', { goals: [{ ref: '3', name: 'x' }] })).toEqual(['there is no goal "3"'])
    expect(await readFile(fileOf('arthur'), 'utf8')).toBe(before)
  })

  it('stores visual identity in the entity file and generates its stable portrait', async () => {
    await editWorldCharacter(world, 'clara', { visualIdentity: { description: 'Dark curls and a red waistcoat.', tags: ['dark curls'], negativeTags: ['hat'], globalId: 'person-clara' } })
    expect(await read('clara')).toMatchObject({ visual_identity: { description: 'Dark curls and a red waistcoat.', tags: ['dark curls'], negative_tags: ['hat'], global_id: 'person-clara' } })
    const state = await generateWorldCharacterPortrait(world, 'clara', new Images())
    expect(state.characters.find(character => character.key === 'clara')?.portrait).toContain('/worlds/state/character/portrait/file?')
    expect(await readFile(join(world.directory, 'images', 'global', 'person-clara', 'reference.png'))).toBeTruthy()
  })

  it('edits places and things without changing their structural fields', async () => {
    const place = await editWorldPlace(world, 'bar', { description: 'A crowded public room.', features: [{ key: 'counter', name: 'Counter', description: 'Dark oak.' }] })
    expect(place.places.find(entry => entry.key === 'bar')).toMatchObject({ description: 'A crowded public room.', features: [{ key: 'counter', name: 'Counter' }] })
    const things = await editWorldThing(world, 'ledger', { quality: 'water-damaged', notable: true, quantity: 2 })
    expect(things.things).toEqual([expect.objectContaining({ key: 'ledger', quality: 'water-damaged', notable: true, quantity: 2, holder: 'The Bar' })])
    expect(JSON.parse(await readFile(join(world.directory, 'items', 'ledger', 'item.json'), 'utf8')).location).toBe('bar')
  })

  it('edits faction identity and state while preserving its social graph', async () => {
    const state = await editWorldFaction(world, 'watch', { name: 'Night Watch', values: ['order', 'duty'], state: { publicState: 'On alert.' } })
    expect(state.factions[0]).toMatchObject({ name: 'Night Watch', values: ['order', 'duty'], state: { publicState: 'On alert.' }, members: [{ character: 'clara' }] })
    expect(JSON.parse(await readFile(join(world.directory, 'factions', 'watch', 'faction.json'), 'utf8')).members).toHaveLength(1)
  })

  it('edits and removes graph relations through stable relation keys', async () => {
    const initial = await readWorldEditor(world)
    const relationship = initial.relations.find(relation => relation.kind === 'character')!
    const changed = await editWorldRelation(world, { kind: 'character', key: relationship.key, label: 'trusted guest', trust: 0.5 })
    expect(changed.relations.find(relation => relation.key === relationship.key)).toMatchObject({ label: 'trusted guest', trust: 0.5 })
    const route = changed.relations.find(relation => relation.kind === 'exit')!
    const removed = await editWorldRelation(world, { kind: 'exit', key: route.key, remove: true })
    expect(removed.relations.some(relation => relation.key === route.key)).toBe(false)
  })

  it('creates typed graph relations in their owning files', async () => {
    let state = await editWorldRelation(world, { create: true, kind: 'character', from: 'arthur', to: 'clara', label: 'innkeeper', trust: 0.2 })
    expect(state.relations).toContainEqual(expect.objectContaining({ kind: 'character', from: expect.objectContaining({ key: 'arthur' }), to: expect.objectContaining({ key: 'clara' }), label: 'innkeeper' }))
    state = await editWorldRelation(world, { create: true, kind: 'knowledge', from: 'arthur', toKind: 'item', to: 'ledger' })
    expect(state.relations).toContainEqual(expect.objectContaining({ kind: 'knowledge', to: expect.objectContaining({ key: 'ledger' }) }))
    state = await editWorldRelation(world, { create: true, kind: 'membership', from: 'arthur', to: 'watch', role: 'consultant' })
    expect(state.relations).toContainEqual(expect.objectContaining({ kind: 'membership', from: expect.objectContaining({ key: 'arthur' }) }))
  })
})

describe('lore entries of a world', () => {
  it('are added by title with a key of their own, never over an existing one, and removed into the trash', async () => {
    const { addWorldLore, removeWorldLore } = await import('../../../src/host/worlds/lore-entries.ts')
    const first = await addWorldLore(world, 'The Tide Laws')
    expect(first.key).toBe('the-tide-laws')
    expect(first.state.lore?.map(entry => entry.title)).toEqual(['The Tide Laws'])
    const second = await addWorldLore(world, 'The Tide Laws')
    expect(second.key).toBe('the-tide-laws-2')
    await expect(addWorldLore(world, '   ')).rejects.toThrow(/needs a title/)
    const after = await removeWorldLore(world, 'the-tide-laws')
    expect(after.lore?.map(entry => entry.key)).toEqual(['the-tide-laws-2'])
    const { readdir } = await import('node:fs/promises')
    expect((await readdir(join(world.directory, '.trash', 'lore'))).length).toBe(1)
    await expect(removeWorldLore(world, 'nothing')).rejects.toThrow(/no lore entry/)
  })

  it('stay while other lore still refers to them', async () => {
    const { addWorldLore, removeWorldLore } = await import('../../../src/host/worlds/lore-entries.ts')
    await addWorldLore(world, 'Origin')
    await write(join(world.directory, 'lore', 'sequel', 'lore.json'), { title: 'Sequel', related: ['origin'] })
    await expect(removeWorldLore(world, 'origin')).rejects.toThrow(/Sequel/)
    expect((await removeWorldLore(world, 'sequel')).lore?.map(entry => entry.key)).toEqual(['origin'])
  })
})
