import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { parseLocationFile } from '../../../src/host/locations/location-file.ts'
import { loadLocations, parentsFirst } from '../../../src/host/locations/load.ts'
import { parseCharacterFile } from '../../../src/host/characters/character-file.ts'

let world: string

async function place(folder: string, content: unknown): Promise<void> {
  const dir = join(world, 'locations', folder)
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, 'location.json'), typeof content === 'string' ? content : JSON.stringify(content))
}

beforeEach(async () => { world = await mkdtemp(join(tmpdir(), 'locations-')) })
afterEach(async () => { await rm(world, { recursive: true, force: true }) })

describe('a location file', () => {
  it('reads the name, the place it is in, its features and its exits, with the folder name as the default id', () => {
    const result = parseLocationFile(JSON.stringify({
      name: 'The Bar', description: 'Smoky.', parent: 'town',
      features: [{ id: 'counter', name: 'Counter', description: 'Long.' }],
      exits: [{ to: 'street', description: 'the door', travel_time_seconds: 20 }, { to: 'cellar', one_way: true, state: 'locked', note: 'brass key', back_description: 'a hatch' }],
    }), 'bar')
    expect(result).toEqual({
      ok: true,
      value: {
        id: 'bar', name: 'The Bar', description: 'Smoky.', parent: 'town',
        features: [{ key: 'counter', name: 'Counter', description: 'Long.' }],
        exits: [
          { to: 'street', description: 'the door', oneWay: false, travelSeconds: 20, state: 'open', note: '' },
          { to: 'cellar', description: '', oneWay: true, backDescription: 'a hatch', state: 'locked', note: 'brass key' },
        ],
      },
    })
  })

  it('reports each problem with its path', () => {
    const result = parseLocationFile(JSON.stringify({
      features: [{ id: 'a b', name: 'X' }, { id: 'k', name: 'K' }, { id: 'k', name: 'K again' }, { name: 'No id' }],
      exits: [{ description: 'no target' }, { to: 'x', state: 'ajar' }, { to: 'y', travel_time_seconds: 2.5 }, { to: 'z', one_way: 'yes' }],
    }), 'f')
    expect(result.ok).toBe(false)
    const paths = (result.ok ? [] : result.issues).map(issue => issue.path)
    expect(paths).toEqual(expect.arrayContaining(['name', 'features[0].id', 'features[2].id', 'features[3].id', 'exits[0].to', 'exits[1].state', 'exits[2].travel_time_seconds', 'exits[3].one_way']))
  })

  it('refuses too many features and too many exits', () => {
    const features = Array.from({ length: 31 }, (_, index) => ({ id: `f${index}`, name: 'F' }))
    const exits = Array.from({ length: 31 }, (_, index) => ({ to: `p${index}` }))
    const result = parseLocationFile(JSON.stringify({ name: 'Big', features, exits }), 'big')
    expect(result.ok ? [] : result.issues.map(issue => issue.path)).toEqual(['features', 'exits'])
  })

  it('is read for a character as where it starts: the place, where in it and the feature, which need a place', () => {
    const ok = parseCharacterFile(JSON.stringify({ name: 'Arthur', start: { location: 'bar', position: 'at the bar', feature: 'counter' } }), 'arthur')
    expect(ok.ok && ok.value.start.place).toEqual({ location: 'bar', position: 'at the bar', feature: 'counter' })
    const none = parseCharacterFile(JSON.stringify({ name: 'Arthur' }), 'arthur')
    expect(none.ok && none.value.start.place).toBeUndefined()
    const bad = parseCharacterFile(JSON.stringify({ name: 'Arthur', start: { position: 'somewhere' } }), 'arthur')
    expect(bad.ok ? [] : bad.issues).toEqual([{ path: 'start.position', message: 'needs a location' }])
  })
})

describe('loadLocations', () => {
  it('has no places when the world has no locations folder', async () => {
    expect(await loadLocations(world)).toEqual({ locations: [], problems: [] })
  })

  it('reads one place per subfolder and orders them so each follows the one it is in', async () => {
    await place('a-bar', { id: 'bar', name: 'Bar', parent: 'town' })
    await place('b-town', { id: 'town', name: 'Town' })
    await place('c-cellar', { id: 'cellar', name: 'Cellar', parent: 'bar' })
    const { locations, problems } = await loadLocations(world)
    expect(problems).toEqual([])
    expect(locations.map(location => location.id)).toEqual(['bar', 'town', 'cellar'])
    expect(parentsFirst(locations).map(location => location.id)).toEqual(['town', 'bar', 'cellar'])
  })

  it('reports a repeated id, an unknown parent or exit target, a circle and a place in itself, and keeps the rest', async () => {
    await place('one', { id: 'same', name: 'One' })
    await place('two', { id: 'same', name: 'Two' })
    await place('lost', { name: 'Lost', parent: 'nowhere', exits: [{ to: 'ghost' }, { to: 'lost' }] })
    await place('a', { name: 'A', parent: 'b' })
    await place('b', { name: 'B', parent: 'a' })
    await place('self', { name: 'Self', parent: 'self' })
    const { locations, problems } = await loadLocations(world)
    expect(locations).toHaveLength(5)
    const messages = problems.map(problem => problem.message)
    expect(messages).toEqual(expect.arrayContaining([
      'id "same" is already used by one',
      'parent: "nowhere" is not a place of this world',
      'exits[0].to: "ghost" is not a place of this world',
      'exits[1].to: an exit must lead to another place',
      'parent: the places contain each other in a circle',
      'parent: a place cannot be in itself',
    ]))
    expect(messages.filter(message => message.includes('circle'))).toHaveLength(2)
  })

  it('reports a file that is not valid, and a folder without a location.json is not a place', async () => {
    await place('broken', '{ not json')
    await mkdir(join(world, 'locations', 'empty'), { recursive: true })
    const { locations, problems } = await loadLocations(world)
    expect(locations).toEqual([])
    expect(problems).toHaveLength(1)
    expect(problems[0]?.path).toBe(join(world, 'locations', 'broken', 'location.json'))
  })
})
