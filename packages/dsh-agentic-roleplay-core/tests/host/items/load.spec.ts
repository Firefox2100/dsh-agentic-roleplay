import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { LocationDefinition } from 'dsh-roleplay-model'
import { parseItemFile, parseSlotsFile } from '../../../src/host/items/item-file.ts'
import { containersFirst, loadItems } from '../../../src/host/items/load.ts'

let world: string

async function item(folder: string, content: unknown): Promise<void> {
  const dir = join(world, 'items', folder)
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, 'item.json'), typeof content === 'string' ? content : JSON.stringify(content))
}

const places: LocationDefinition[] = [
  { id: 'bar', name: 'The Bar', description: '', features: [{ key: 'counter', name: 'Counter', description: '' }], exits: [{ to: 'street', description: '', oneWay: false, state: 'locked', note: '', openedBy: ['key'] }] },
  { id: 'street', name: 'Street', description: '', features: [], exits: [] },
]
const context = { characters: ['arthur', 'clara'], locations: places }

beforeEach(async () => { world = await mkdtemp(join(tmpdir(), 'items-')) })
afterEach(async () => { await rm(world, { recursive: true, force: true }) })

describe('an item file', () => {
  it('reads what a thing is, with what is left out at its default, and where it starts', () => {
    const result = parseItemFile(JSON.stringify({ name: 'Brass key', unique: true, notable: true, quality: 'worn', owner: 'clara', location: 'bar', position: 'by the till', feature: 'counter' }), 'brass-key')
    expect(result).toEqual({
      ok: true,
      value: { id: 'brass-key', name: 'Brass key', description: '', quantity: 1, unique: true, quality: 'worn', notable: true, hidden: false, owner: 'clara', start: { kind: 'location', location: 'bar', position: 'by the till', feature: 'counter' } },
    })
  })

  it('reads a wearable thing worn, a container with what opens it, a pile carried, and a thing inside another', () => {
    const worn = parseItemFile(JSON.stringify({ name: 'Coat', wearable: 'torso', worn_by: 'arthur', position: 'over the shoulders' }), 'coat')
    expect(worn.ok && worn.value).toMatchObject({ wearable: 'torso', start: { kind: 'worn', character: 'arthur', position: 'over the shoulders' } })
    const chest = parseItemFile(JSON.stringify({ name: 'Chest', container: { state: 'locked', opened_by: ['key'] }, hidden: true, location: 'bar' }), 'chest')
    expect(chest.ok && chest.value).toMatchObject({ hidden: true, container: { state: 'locked', openedBy: ['key'] } })
    const coins = parseItemFile(JSON.stringify({ name: 'Coin', quantity: 40, held_by: 'clara' }), 'coin')
    expect(coins.ok && coins.value).toMatchObject({ quantity: 40, start: { kind: 'held', character: 'clara' } })
    const inside = parseItemFile(JSON.stringify({ name: 'Letter', inside: 'chest', position: 'on top' }), 'letter')
    expect(inside.ok && inside.value.start).toEqual({ kind: 'inside', item: 'chest', position: 'on top' })
    expect(parseItemFile(JSON.stringify({ name: 'Box', container: {}, location: 'bar' }), 'box').ok && true).toBe(true)
  })

  it('reports each problem with its path: no place or two, a worn thing that is not wearable, a pile that is unique, bad numbers and flags', () => {
    const issues = (content: unknown) => { const result = parseItemFile(JSON.stringify(content), 'x'); return result.ok ? [] : result.issues.map(issue => issue.path) }
    expect(issues({ name: 'A' })).toEqual(['location'])
    expect(issues({ name: 'A', location: 'bar', held_by: 'clara' })).toEqual(['held_by'])
    expect(issues({ name: 'A', worn_by: 'clara' })).toEqual(['worn_by'])
    expect(issues({ name: 'A', location: 'bar', unique: true, quantity: 3 })).toEqual(['unique'])
    expect(issues({ name: 'A', location: 'bar', quantity: 0, notable: 'yes' })).toEqual(['quantity', 'notable'])
    expect(issues({ name: 'A', location: 'bar', quantity: 2.5 })).toEqual(['quantity'])
    expect(issues({ name: 'A', held_by: 'clara', feature: 'counter' })).toEqual(['feature'])
    expect(issues({ name: 'A', location: 'bar', wearable: 'Not A Slot' })).toEqual(['wearable'])
    expect(issues({ location: 'bar' })).toEqual(['name'])
  })

  it('reads a list of slots, and reports each that is wrong', () => {
    expect(parseSlotsFile(JSON.stringify([{ id: 'tail', name: 'tail', capacity: 1 }, { id: 'torso', name: 'body', capacity: 3 }]))).toEqual({ ok: true, value: [{ id: 'tail', name: 'tail', capacity: 1 }, { id: 'torso', name: 'body', capacity: 3 }] })
    const bad = parseSlotsFile(JSON.stringify([{ id: 'Tail', name: '', capacity: 0 }, 'x']))
    expect(bad.ok ? [] : bad.issues.map(issue => issue.path)).toEqual(['[0].id', '[0].name', '[0].capacity', '[1]'])
    expect(parseSlotsFile('{').ok).toBe(false)
    expect(parseSlotsFile('{}').ok).toBe(false)
  })
})

describe('loadItems', () => {
  it('has nothing and the usual slots when the world has no items folder', async () => {
    const loaded = await loadItems(world, { characters: context.characters, locations: [] })
    expect(loaded.items).toEqual([])
    expect(loaded.slots.map(slot => slot.id)).toEqual(expect.arrayContaining(['head', 'torso', 'fingers']))
    expect(loaded.problems).toEqual([])
  })

  it('reads one item per subfolder, adds the slots a world brings to the usual ones, and lets it change how many fit', async () => {
    await item('key', { name: 'Key', location: 'bar' })
    await item('quiver', { name: 'Quiver', wearable: 'quiver', worn_by: 'arthur' })
    await writeFile(join(world, 'items', 'slots.json'), JSON.stringify([{ id: 'quiver', name: 'quiver', capacity: 1 }, { id: 'torso', name: 'torso', capacity: 3 }]))
    const { items, slots, problems } = await loadItems(world, context)
    expect(problems).toEqual([])
    expect(items.map(entry => entry.id)).toEqual(['key', 'quiver'])
    expect(slots.find(slot => slot.id === 'quiver')).toEqual({ id: 'quiver', name: 'quiver', capacity: 1 })
    expect(slots.find(slot => slot.id === 'torso')?.capacity).toBe(3)
    expect(slots.filter(slot => slot.id === 'torso')).toHaveLength(1)
  })

  it('reports a repeated id, a slot that does not exist, an unknown place, feature, character, owner, lock key or container, a circle, and keeps the rest', async () => {
    await item('a', { id: 'same', name: 'One', location: 'bar' })
    await item('b', { id: 'same', name: 'Two', location: 'bar' })
    await item('hat', { name: 'Hat', wearable: 'crown', location: 'moon' })
    await item('c', { name: 'C', location: 'bar', feature: 'piano', owner: 'ghost' })
    await item('d', { name: 'D', held_by: 'ghost' })
    await item('e', { name: 'E', container: { opened_by: ['nothing'] }, location: 'bar' })
    await item('f', { name: 'F', inside: 'nothing' })
    await item('g', { name: 'G', inside: 'c' })
    await item('x', { name: 'X', container: {}, inside: 'y' })
    await item('y', { name: 'Y', container: {}, inside: 'x' })
    const { items, problems } = await loadItems(world, context)
    expect(items).toHaveLength(9)
    const messages = problems.map(problem => problem.message)
    for (const expected of ['id "same" is already used by a', /wearable: "crown" is not a slot/, 'location: "moon" is not a place of this world', 'feature: The Bar has no feature "piano"', 'owner: "ghost" is not a character of this world',
      'held_by: "ghost" is not a character of this world', 'container.opened_by: "nothing" is not an item of this world', 'inside: "nothing" is not an item of this world', 'inside: C is not a container', 'inside: the items are inside each other in a circle']) {
      expect(messages).toEqual(expect.arrayContaining([typeof expected === 'string' ? expected : expect.stringMatching(expected)]))
    }
  })

  it('reports what opens a way that is not an item, with the place file it is in', async () => {
    await item('lamp', { name: 'Lamp', location: 'bar' })
    const loaded = await loadItems(world, { characters: [], locations: places })
    expect(loaded.problems).toEqual([{ path: join(world, 'locations', 'bar', 'location.json'), message: 'exits[0].opened_by: "key" is not an item of this world' }])
    await item('key', { name: 'Key', location: 'bar' })
    expect((await loadItems(world, { characters: [], locations: places })).problems).toEqual([])
  })

  it('reports a file that is not valid, and a folder without an item.json is not an item', async () => {
    await item('broken', '{ not json')
    await mkdir(join(world, 'items', 'empty'), { recursive: true })
    const { items, problems } = await loadItems(world, { characters: context.characters, locations: [] })
    expect(items).toEqual([])
    expect(problems).toHaveLength(1)
  })
})

describe('the order things are made in', () => {
  it('puts a container before what is in it, however deep', () => {
    const make = (id: string, start: { kind: 'location'; location: string } | { kind: 'inside'; item: string }) => ({ id, name: id, description: '', quantity: 1, unique: false, quality: '', notable: false, hidden: false, start })
    const ordered = containersFirst([make('c', { kind: 'inside', item: 'b' }), make('b', { kind: 'inside', item: 'a' }), make('a', { kind: 'location', location: 'bar' })])
    expect(ordered.map(entry => entry.id)).toEqual(['a', 'b', 'c'])
  })
})
