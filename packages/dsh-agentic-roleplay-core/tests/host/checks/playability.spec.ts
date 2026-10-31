import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { checkImported } from '../../../src/host/checks/imported.ts'
import { loaded } from '../../../src/host/checks/loaded.ts'
import { runChecks } from '../../../src/host/checks/run.ts'
import { fakeModel } from '../../support/checks.ts'

let directory: string
const write = async (path: string, value: unknown) => { await mkdir(join(path, '..'), { recursive: true }); await writeFile(path, `${JSON.stringify(value)}\n`) }
const summary = { id: 'harbor', name: 'Harbor', description: '', tags: [] as string[] }
const quick = async () => await runChecks({ world: { directory, summary } as never }, { kits: ['playability'] })

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'playability-'))
  await write(join(directory, 'world.json'), { id: 'harbor', name: 'Harbor', opening_message: 'Rain on the shutters.' })
  await write(join(directory, 'locations', 'inn', 'location.json'), { name: 'The Inn', description: 'Low beams and a fire.' })
  await write(join(directory, 'locations', 'dock', 'location.json'), { name: 'The Dock', description: 'Wet planks.' })
  await write(join(directory, 'characters', 'clara', 'character.json'), { name: 'Clara', role: 'playable', tier: 'principal', summary: 'Innkeeper.', start: { location: 'inn' } })
  await write(join(directory, 'characters', 'tam', 'character.json'), { name: 'Tam', role: 'npc', tier: 'principal', summary: 'A sailor.', start: { location: 'inn' } })
})
afterEach(async () => { await rm(directory, { recursive: true, force: true }) })

describe('the first scene', () => {
  it('has nothing to say of a start with company', async () => {
    expect((await quick()).findings).toEqual([])
  })

  it('names a player who starts alone, nowhere, or in an empty place', async () => {
    await write(join(directory, 'characters', 'tam', 'character.json'), { name: 'Tam', role: 'npc', tier: 'principal', summary: 'A sailor.', start: { location: 'dock' } })
    expect((await quick()).findings.map(finding => finding.code)).toEqual(['start-empty'])
    await write(join(directory, 'characters', 'clara', 'character.json'), { name: 'Clara', role: 'playable', tier: 'principal', summary: 'Innkeeper.' })
    expect((await quick()).findings.map(finding => finding.code)).toContain('start-nowhere')
  })

  it('is skipped for a world nobody can play', async () => {
    await write(join(directory, 'characters', 'clara', 'character.json'), { name: 'Clara', role: 'npc', tier: 'principal', summary: 'Innkeeper.' })
    expect((await quick()).skipped.find(entry => entry.check === 'first-scene')?.reason).toContain('no character can be played')
  })
})

describe('the opening, judged', () => {
  it('shows a model the opening and the first scene and reports a flat start with its reason', async () => {
    const seen: string[] = []
    const report = await runChecks({ world: { directory, summary } as never, model: fakeModel(job => { seen.push(job.prompt); return { reason: 'nothing to do', playable: false } }) }, { kits: ['playability'], deep: true, ids: ['opening-playable'] })
    expect(seen[0]).toContain('Rain on the shutters.')
    expect(seen[0]).toContain('here: Tam')
    expect(report.findings).toEqual([expect.objectContaining({ code: 'opening-flat', where: 'characters/clara', message: expect.stringContaining('nothing to do') })])
  })
})

describe('what a run reads', () => {
  it('is read once for all the checks of the run', async () => {
    const memo = new Map<string, Promise<unknown>>()
    const input = { world: { directory, summary } as never, memo }
    expect(loaded.characters(input)).toBe(loaded.characters(input))
    expect(loaded.characters({ world: input.world })).not.toBe(loaded.characters({ world: input.world }))
  })
})

describe('the yes-or-no checks, run unasked', () => {
  it('run with a decision model asked for, and the judged ones stay skipped', async () => {
    const model = fakeModel(() => ({ reason: 'fine', playable: true }))
    const report = await runChecks({ world: { directory, summary } as never, model }, { deep: 'decision' })
    expect(report.ran).toEqual(expect.arrayContaining(['sheet-playable', 'opening-playable']))
    expect(report.skipped.map(entry => entry.check)).toEqual(expect.arrayContaining(['world-gaps']))
    expect(report.skipped.map(entry => entry.check)).not.toContain('sheet-playable')
  })
})

describe('what the assistant reads', () => {
  it('tells many findings of one kind as one entry that says how many and where', async () => {
    const { grouped } = await import('../../../src/host/checks/present.ts')
    const alike = Array.from({ length: 9 }, (_, at) => ({ check: 'world-graph', severity: 'warning' as const, code: 'location-unreachable', where: `location:p${at}`, message: `p${at} cannot be reached` }))
    const other = { check: 'quality-cast', severity: 'warning' as const, code: 'no-playable', where: 'characters', message: 'nobody can be played' }
    const few = alike.slice(0, 3)
    expect(grouped([...alike, other])).toEqual([expect.objectContaining({ code: 'location-unreachable', where: 'location:p0', count: 9, also: expect.arrayContaining(['location:p1']) }), other])
    expect(grouped(few)).toEqual(few)
  })
})

describe('what an import checks unasked', () => {
  it('asks a decision model the yes-or-no checks, and none when the import has no decision model', async () => {
    const asked: string[] = []
    const answer = (job: { prompt: string }) => { asked.push(job.prompt); return { reason: 'fine', playable: true } }
    await checkImported(directory, 'Harbor', fakeModel(answer))
    expect(asked).toEqual([])
    const decided = fakeModel(answer, { decide: () => Promise.resolve(new Map([['playable', 0.95]])) })
    await checkImported(directory, 'Harbor', decided)
    expect(asked).toEqual([])
    const unsure = fakeModel(answer, { decide: () => Promise.resolve(new Map([['playable', 0.5]])) })
    await checkImported(directory, 'Harbor', unsure)
    expect(asked.length).toBeGreaterThan(0)
  })
})
