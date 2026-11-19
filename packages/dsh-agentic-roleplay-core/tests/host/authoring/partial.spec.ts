import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { updatePlot, updateWorldFileEntry, worldFileKeys } from '../../../src/host/authoring/partial.ts'

let directory: string
const world = () => ({ id: 'harbor', directory })
const read = async (file: string) => JSON.parse(await readFile(join(directory, file), 'utf8')) as unknown

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'authoring-partial-'))
  await writeFile(join(directory, 'world.json'), JSON.stringify({ id: 'harbor', name: 'Harbor' }))
})
afterEach(async () => { await rm(directory, { recursive: true, force: true }) })

describe('changing one entry of a whole-world file', () => {
  const variables = [
    { key: 'tiredness', name: 'Tiredness', kind: 'number', subject: 'character', visibility: 'public', update: 'rises when the character works', default: 0 },
    { key: 'weather', name: 'Weather', kind: 'choice', subject: 'world', visibility: 'public', options: ['fair', 'rain'], default: 'fair', update: 'changes with the day' },
  ]

  it('changes the fields named and leaves the other entries as they are', async () => {
    await writeFile(join(directory, 'variables.json'), JSON.stringify(variables))
    await updateWorldFileEntry(world(), 'variables', 'tiredness', { name: 'Fatigue' })
    const after = await read('variables.json') as Record<string, unknown>[]
    expect(after[0]).toMatchObject({ key: 'tiredness', name: 'Fatigue', update: 'rises when the character works' })
    expect(after[1]).toEqual(variables[1])
  })

  it('lists the keys there are when the key names nothing, and refuses an empty change', async () => {
    await writeFile(join(directory, 'variables.json'), JSON.stringify(variables))
    await expect(updateWorldFileEntry(world(), 'variables', 'hunger', { name: 'X' })).rejects.toThrow('the keys are: tiredness, weather')
    await expect(updateWorldFileEntry(world(), 'variables', 'tiredness', {})).rejects.toThrow('changes must be an object')
  })

  it('checks the result and writes nothing when it is refused', async () => {
    await writeFile(join(directory, 'variables.json'), JSON.stringify(variables))
    await expect(updateWorldFileEntry(world(), 'variables', 'tiredness', { update: '' })).rejects.toThrow('say when and how it changes')
    expect(await read('variables.json')).toEqual(variables)
  })
})

describe('changing one plot', () => {
  const plot = (id: string, premise: string) => ({ id, name: id, premise, participants: [], hooks: [{ id: 'h', text: 'A hook.', mode: 'opportunity' }], developments: [], resolutions: ['It ends.'] })

  it('changes one plot and keeps the others', async () => {
    await writeFile(join(directory, 'plots.json'), JSON.stringify([plot('a', 'One.'), plot('b', 'Two.')]))
    await updatePlot(world(), 'b', { premise: 'Changed.' })
    const after = await read('plots.json') as Record<string, unknown>[]
    expect(after.map(entry => [entry['id'], entry['premise']])).toEqual([['a', 'One.'], ['b', 'Changed.']])
    expect(after[1]!['hooks']).toHaveLength(1)
  })

  it('lists the plots there are when the key names nothing', async () => {
    await writeFile(join(directory, 'plots.json'), JSON.stringify([plot('a', 'One.'), plot('b', 'Two.')]))
    await expect(updatePlot(world(), 'c', { premise: 'X' })).rejects.toThrow('the keys are: a, b')
  })
})

describe('the keys of a whole-world file', () => {
  it('are listed the way update_world_file names them', () => {
    expect(worldFileKeys('variables', [{ key: 'mood' }, { key: 'grain' }])).toEqual(['mood', 'grain'])
    expect(worldFileKeys('dice', { checks: [{ key: 'strike' }] })).toEqual(['strike'])
    expect(worldFileKeys('commands', { commands: [{ word: 'haggle' }, { word: '招募', key: 'recruit_zh' }] })).toEqual(['haggle', 'recruit_zh'])
    expect(worldFileKeys('calendar', { hemisphere: 'north', holidays: [{ id: 'harvest' }] })).toEqual(['harvest'])
    expect(worldFileKeys('dice', { checks: [] })).toEqual([])
  })
})
