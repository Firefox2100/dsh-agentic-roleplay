import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { editRoutine, editVariables, readRoutines, readVariables } from '../../../src/host/worlds/daily-life.ts'
import { parseRoutineEdit, parseVariablesEdit } from '../../../src/shared/world-daily.ts'

let world: { id: string; directory: string }
const write = async (path: string, value: unknown) => { await mkdir(join(path, '..'), { recursive: true }); await writeFile(path, `${JSON.stringify(value, null, 4)}\n`) }
const characterFile = () => join(world.directory, 'characters', 'clara', 'character.json')

beforeEach(async () => {
  world = { id: 'w', directory: await mkdtemp(join(tmpdir(), 'daily-life-')) }
  await write(join(world.directory, 'world.json'), { id: 'w', name: 'W' })
  await write(join(world.directory, 'locations', 'bar', 'location.json'), { name: 'The Bar', features: [{ id: 'counter', name: 'Counter' }] })
  await write(characterFile(), { name: 'Clara', role: 'npc', extra: { kept: true }, variables: { mood: 3 } })
})
afterEach(async () => { await rm(world.directory, { recursive: true, force: true }) })

describe('the days of the characters of a world', () => {
  it('are read with the places a window can name, replaced in the file without touching the rest, and cleared', async () => {
    expect((await readRoutines(world)).places).toEqual([{ key: 'bar', name: 'The Bar', features: [{ key: 'counter', name: 'Counter' }] }])
    const windows = parseRoutineEdit({ windows: [{ days: ['Mon', 'tue'], from: '07:30', to: '12:00', activity: 'Opens the bar', location: 'bar', feature: 'counter' }] })
    const done = await editRoutine(world, 'clara', windows)
    expect(done.characters[0]?.routine).toEqual([{ days: ['mon', 'tue'], from: '07:30', to: '12:00', activity: 'Opens the bar', location: 'bar', feature: 'counter', interruptible: true }])
    expect(JSON.parse(await readFile(characterFile(), 'utf8'))).toMatchObject({ extra: { kept: true }, variables: { mood: 3 } })
    await editRoutine(world, 'clara', [])
    expect(JSON.parse(await readFile(characterFile(), 'utf8'))).not.toHaveProperty('routine')
  })

  it('are refused when a time, a day or a place is wrong, and nothing is written', async () => {
    const before = await readFile(characterFile(), 'utf8')
    await expect(editRoutine(world, 'clara', parseRoutineEdit({ windows: [{ from: '7am', to: '12:00', activity: 'x' }] }))).rejects.toThrow(/time of day/)
    await expect(editRoutine(world, 'clara', parseRoutineEdit({ windows: [{ days: ['funday'], from: '07:00', to: '12:00', activity: 'x' }] }))).rejects.toThrow(/not a day/)
    await expect(editRoutine(world, 'clara', parseRoutineEdit({ windows: [{ from: '07:00', to: '12:00', activity: 'x', location: 'moon' }] }))).rejects.toThrow(/not a place/)
    await expect(editRoutine(world, 'nobody', [])).rejects.toThrow(/no character/)
    expect(await readFile(characterFile(), 'utf8')).toBe(before)
    expect(() => parseRoutineEdit({ windows: [{ from: 7, to: '1', activity: 'x', nope: 1 }] })).toThrow(/from must be text/)
  })
})

describe('the variables of a world', () => {
  const mood = { key: 'mood', name: 'Mood', kind: 'number', subject: 'character', visibility: 'public', min: 0, max: 10, default: 5, bands: [{ up_to: 3, label: 'low' }, { up_to: 10, label: 'high' }] }

  it('are declared in variables.json, read back, and the file goes when none are left', async () => {
    expect(await readVariables(world)).toEqual([])
    const saved = await editVariables(world, parseVariablesEdit({ variables: [{ ...mood, integer: true }] }))
    expect(saved).toMatchObject([{ key: 'mood', integer: true, bands: [{ up_to: 3, label: 'low' }, { up_to: 10, label: 'high' }] }])
    await expect(editVariables(world, [])).rejects.toThrow(/mood/)
    await write(characterFile(), { name: 'Clara', role: 'npc' })
    expect(await editVariables(world, [])).toEqual([])
    await expect(readFile(join(world.directory, 'variables.json'))).rejects.toThrow()
  })

  it('are refused when a value somewhere no longer fits, or the declaration is not one', async () => {
    await expect(editVariables(world, parseVariablesEdit({ variables: [{ ...mood, max: 2 }] }))).rejects.toThrow(/mood/)
    await expect(editVariables(world, parseVariablesEdit({ variables: [mood, mood] }))).rejects.toThrow(/twice/)
    expect(() => parseVariablesEdit({ variables: [{ ...mood, kind: 'colour', min: 'x' }] })).toThrow(/kind must be one of/)
    await expect(readFile(join(world.directory, 'variables.json'))).rejects.toThrow()
  })

  it('leave out what is empty when they come from the browser', () => {
    expect(parseVariablesEdit({ variables: [{ key: ' k ', name: 'K', kind: 'flag', subject: 'world', visibility: 'hidden', description: '', default: '', only: [' '], bands: [] }] })).toEqual([{ key: 'k', name: 'K', kind: 'flag', subject: 'world', visibility: 'hidden' }])
  })
})
