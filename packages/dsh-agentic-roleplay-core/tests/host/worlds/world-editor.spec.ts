import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ImageGenerationService, type ImageGenerationResult } from '@dsh-ai-providers/core'
import { editWorldLore, editWorldCharacter, editWorldFaction, editWorldNarrationVoice, editWorldPlace, editWorldRelation, editWorldThing, generateWorldCharacterPortrait, generateWorldEntityImage, readWorldEditor, uploadWorldCharacterPortrait, uploadWorldEntityImage, worldEntityImageFile, readWorldTrigger, removeWorldTrigger, writeWorldTrigger } from '../../../src/host/worlds/world-editor.ts'
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

describe('the triggers of a world in the editor', () => {
  it('are shown with what each names that the world does not have, and the file is reported when it cannot be read', async () => {
    await write(join(world.directory, 'triggers.json'), [
      { key: 'knock', name: 'Knock', when: { type: 'place', character: 'clara', location: 'bar' }, effects: [{ type: 'beat', text: 'Someone knocks.' }], announce: { audience: 'everyone', text: 'A visitor is expected.' } },
      { key: 'ghost', name: 'Ghost', when: { type: 'place', character: 'clara', location: 'moon' }, effects: [{ type: 'beat', text: 'x' }], repeat: true, priority: 2 },
    ])
    const unchecked = await readWorldEditor(world)
    expect(unchecked.triggers?.map(entry => [entry.key, entry.problems])).toEqual([['knock', []], ['ghost', []]])
    expect(unchecked.triggersProblem).toMatch(/could not be checked.*no feature "counter"/)
    await write(fileOf('clara'), { name: 'Clara', role: 'npc', start: { location: 'bar' } })
    expect((await readWorldEditor(world)).triggers).toEqual([
      { key: 'knock', name: 'Knock', when: { type: 'place', character: 'clara', location: 'bar' }, effects: [{ type: 'beat', text: 'Someone knocks.' }], repeat: false, priority: 0, announced: true, problems: [] },
      { key: 'ghost', name: 'Ghost', when: { type: 'place', character: 'clara', location: 'moon' }, effects: [{ type: 'beat', text: 'x' }], repeat: true, priority: 2, announced: false, problems: ['when: there is no place "moon"'] },
    ])
    await writeFile(join(world.directory, 'triggers.json'), '{ nope')
    const broken = await readWorldEditor(world)
    expect(broken.triggers).toEqual([])
    expect(broken.triggersProblem).toMatch(/invalid JSON/)
  })
})

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

  it('takes a PNG the author brought as the portrait, with no visual identity needed, and refuses any other picture', async () => {
    const state = await uploadWorldCharacterPortrait(world, 'clara', new Uint8Array(PNG), 'clara face.png')
    expect(state.characters.find(character => character.key === 'clara')?.portrait).toBeTruthy()
    expect(await readFile(join(world.directory, 'images', 'characters', 'clara', 'reference.png'))).toBeTruthy()
    await expect(uploadWorldCharacterPortrait(world, 'clara', new Uint8Array([0xff, 0xd8, 0xff]), 'face.jpg')).rejects.toThrow(/must be a PNG/)
  })

  it('makes the reference picture of a place or a thing from its visual identity, takes one the author brought, and shows where it is', async () => {
    await expect(generateWorldEntityImage(world, 'place', 'bar', new Images())).rejects.toThrow(/needs a visual identity/)
    await editWorldPlace(world, 'bar', { visualIdentity: { description: 'A low room of dark oak.', tags: ['oak'], negativeTags: [] } })
    const placed = await generateWorldEntityImage(world, 'place', 'bar', new Images())
    expect(placed.places.find(entry => entry.key === 'bar')?.image).toContain('/worlds/state/place/image/file?')
    expect(await readFile(join(world.directory, 'images', 'locations', 'bar', 'reference.png'))).toBeTruthy()
    const held = await uploadWorldEntityImage(world, 'thing', 'ledger', new Uint8Array(PNG), 'ledger.png')
    expect(held.things.find(entry => entry.key === 'ledger')?.image).toContain('/worlds/state/thing/image/file?')
    expect((await worldEntityImageFile(world, 'thing', 'ledger')).size).toBeGreaterThan(0)
    await expect(uploadWorldEntityImage(world, 'thing', 'ledger', new Uint8Array([0xff, 0xd8, 0xff]), 'ledger.jpg')).rejects.toThrow(/must be a PNG/)
    await expect(worldEntityImageFile(world, 'place', 'nowhere')).rejects.toThrow('there is no place "nowhere"')
  })

  it('makes, reads, replaces and removes a trigger of the world file, refusing what the world cannot carry', async () => {
    await editWorldPlace(world, 'bar', { features: [{ key: 'counter', name: 'Counter', description: '' }] })
    const made = await writeWorldTrigger(world, 'knock', { name: 'Knock', when: { type: 'event', tag: 'door' }, effects: [{ type: 'beat', text: 'A knock at the door.' }] })
    expect(made.triggers?.map(trigger => trigger.key)).toEqual(['knock'])
    expect(await readWorldTrigger(world, 'knock')).toMatchObject({ key: 'knock', name: 'Knock' })
    const changed = await writeWorldTrigger(world, 'knock', { name: 'Loud knock', repeat: true, when: { type: 'event', tag: 'door' }, effects: [{ type: 'beat', text: 'A loud knock.' }] })
    expect(changed.triggers?.[0]).toMatchObject({ name: 'Loud knock', repeat: true })
    await expect(writeWorldTrigger(world, 'bad', { name: 'Bad', colour: 'red', when: { type: 'event', tag: 'x' }, effects: [] })).rejects.toThrow(InvalidEditProblems)
    await expect(readWorldTrigger(world, 'bad')).rejects.toThrow('there is no trigger "bad"')
    expect((await removeWorldTrigger(world, 'knock')).triggers).toEqual([])
    await expect(removeWorldTrigger(world, 'knock')).rejects.toThrow('there is no trigger "knock"')
  })

  it('edits places and things without changing their structural fields', async () => {
    const place = await editWorldPlace(world, 'bar', { description: 'A crowded public room.', features: [{ key: 'counter', name: 'Counter', description: 'Dark oak.' }] })
    expect(place.places.find(entry => entry.key === 'bar')).toMatchObject({ description: 'A crowded public room.', features: [{ key: 'counter', name: 'Counter' }] })
    const things = await editWorldThing(world, 'ledger', { quality: 'water-damaged', notable: true, quantity: 2 })
    expect(things.things).toEqual([expect.objectContaining({ key: 'ledger', quality: 'water-damaged', notable: true, quantity: 2, holder: 'The Bar' })])
    expect(JSON.parse(await readFile(join(world.directory, 'items', 'ledger', 'item.json'), 'utf8')).location).toBe('bar')
  })

  it('puts a place inside another and takes it out again, refuses a place that is not there and a circle, and gives a thing an owner or none', async () => {
    const inside = await editWorldPlace(world, 'cellar', { parent: 'bar' })
    expect(inside.places.find(entry => entry.key === 'cellar')?.parent).toEqual({ key: 'bar', name: 'The Bar' })
    expect(JSON.parse(await readFile(join(world.directory, 'locations', 'cellar', 'location.json'), 'utf8')).parent).toBe('bar')
    await expect(editWorldPlace(world, 'bar', { parent: 'cellar' })).rejects.toThrow(/inside itself/)
    await expect(editWorldPlace(world, 'bar', { parent: 'nowhere' })).rejects.toThrow(/no place "nowhere"/)
    const out = await editWorldPlace(world, 'cellar', { parent: null })
    expect(out.places.find(entry => entry.key === 'cellar')).not.toHaveProperty('parent')
    expect(JSON.parse(await readFile(join(world.directory, 'locations', 'cellar', 'location.json'), 'utf8'))).not.toHaveProperty('parent')

    const owned = await editWorldThing(world, 'ledger', { owner: 'clara' })
    expect(owned.things[0]?.owner).toEqual({ key: 'clara', name: 'Clara' })
    await expect(editWorldThing(world, 'ledger', { owner: 'ghost' })).rejects.toThrow(/no character "ghost"/)
    expect((await editWorldThing(world, 'ledger', { owner: null })).things[0]).not.toHaveProperty('owner')
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

describe('who knows a lore entry of a world', () => {
  const file = () => join(world.directory, 'lore', 'rite', 'lore.json')
  const readLore = async () => JSON.parse(await readFile(file(), 'utf8')) as Record<string, unknown>

  it('is set by scope and known_by, and a switch to everyone clears the list', async () => {
    await write(file(), { title: 'The rite', summary: 's' })
    const listed = await editWorldLore(world, 'rite', { scope: 'listed', knownBy: ['Clara', 'arthur'] })
    expect(listed.lore?.[0]).toMatchObject({ scope: 'listed', knownBy: ['Clara', 'arthur'] })
    expect(await readLore()).toMatchObject({ scope: 'listed', known_by: ['Clara', 'arthur'] })
    const everyone = await editWorldLore(world, 'rite', { scope: 'everyone' })
    expect(everyone.lore?.[0]).toMatchObject({ scope: 'everyone', knownBy: [] })
    expect(await readLore()).not.toHaveProperty('known_by')
  })

  it('refuses a name no character answers to, and a list for an entry everyone knows', async () => {
    await write(file(), { title: 'The rite', summary: 's' })
    await expect(editWorldLore(world, 'rite', { knownBy: ['Nobody'] })).rejects.toThrow(/"Nobody" is not a character/)
    await editWorldLore(world, 'rite', { scope: 'everyone' })
    await expect(editWorldLore(world, 'rite', { knownBy: ['Clara'] })).rejects.toThrow()
    expect(await readLore()).not.toHaveProperty('known_by')
  })
})
