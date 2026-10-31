import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { CheckSkipped, type Check } from '../../../src/host/checks/check.ts'
import { duplicateValues } from '../../../src/host/checks/consistency.ts'
import { CHECKS_FOLDER } from '../../../src/host/checks/results.ts'
import { CHECKS, runChecks } from '../../../src/host/checks/run.ts'
import { judging } from '../../support/checks.ts'
import { presentReport } from '../../../src/host/checks/present.ts'
import { checkTools } from '../../../src/host/checks/tools.ts'
import { AuthoredWorldReader } from '../../../src/host/authoring/read-tools.ts'
import { authoringChatSessionId } from '../../../src/shared/authoring-chat.ts'
import type { WorldCatalog } from '../../../src/host/worlds/catalog.ts'

let directory: string
const write = async (path: string, value: unknown) => { await mkdir(join(path, '..'), { recursive: true }); await writeFile(path, `${JSON.stringify(value)}\n`) }
const summary = { id: 'harbor', name: 'Harbor', description: 'A fogbound port.', tags: [] }
const world = () => ({ directory, summary }) as never

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'checks-'))
  await write(join(directory, 'world.json'), { id: 'harbor', name: 'Harbor', description: 'A fogbound port.' })
  await write(join(directory, 'locations', 'inn', 'location.json'), { name: 'The Inn', exits: [{ to: 'dock', description: 'a wet lane' }] })
  await write(join(directory, 'locations', 'dock', 'location.json'), { name: 'The Dock', exits: [{ to: 'inn', description: 'back' }] })
  await write(join(directory, 'characters', 'clara', 'character.json'), { name: 'Clara', role: 'playable', summary: 'Innkeeper.', start: { location: 'inn' } })
})
afterEach(async () => { await rm(directory, { recursive: true, force: true }) })

const ofCheck = (report: { findings: { check: string }[] }, id: string) => report.findings.filter(finding => finding.check === id)

describe('the consistency kit', () => {
  it('finds nothing in a sound world', async () => {
    const report = await runChecks({ world: world() }, { kits: ['consistency'] })
    expect(report.findings).toEqual([])
    expect(report.ran).toEqual(['world-valid', 'world-graph', 'duplicate-values', 'name-clashes', 'world-prompts'])
    expect(report.skipped).toEqual([])
  })

  it('names what a story start would refuse, and skips the checks that depend on a readable world', async () => {
    await write(join(directory, 'characters', 'tam', 'character.json'), { name: 'Tam', role: 'npc', summary: 'Fisher.', start: { location: 'nowhere' } })
    const report = await runChecks({ world: world() }, { kits: ['consistency'] })
    expect(ofCheck(report, 'world-valid')).toEqual([expect.objectContaining({ severity: 'error', code: 'invalid', message: expect.stringMatching(/nowhere/) })])
    expect(report.skipped).toEqual([{ check: 'world-graph', reason: expect.stringMatching(/problems that come first/) }])
  })

  it('reports a place nobody can leave', async () => {
    await write(join(directory, 'locations', 'cellar', 'location.json'), { name: 'Cellar' })
    const report = await runChecks({ world: world() }, { kits: ['consistency'] })
    expect(ofCheck(report, 'world-graph')).toEqual([expect.objectContaining({ code: 'location-no-exit', where: 'location:cellar' })])
  })

  it('reports tracked values that are one thing twice, but not different subjects', async () => {
    await write(join(directory, 'variables.json'), [
      { key: 'hp', name: 'Hit points', kind: 'number', subject: 'character' },
      { key: 'health', name: 'Health', kind: 'number', subject: 'character' },
      { key: 'durability', name: 'Health', kind: 'number', subject: 'item' },
    ])
    const found = ofCheck(await runChecks({ world: world() }, { kits: ['consistency'] }), 'duplicate-values')
    expect(found).toEqual([expect.objectContaining({ severity: 'warning', code: 'duplicate-value', message: expect.stringMatching(/hp .*health/) })])
  })

  it('does not call two values the same when they apply to different characters', () => {
    expect(duplicateValues([
      { key: 'hp', name: 'HP', kind: 'number', subject: 'character', only: ['a'] },
      { key: 'health', name: 'Health', kind: 'number', subject: 'character', only: ['b'] },
    ])).toEqual([])
  })

  it('reports an alias that is another character\'s name', async () => {
    await write(join(directory, 'characters', 'tam', 'character.json'), { name: 'Tam', aliases: ['Clara'], role: 'npc', summary: 'Fisher.', start: { location: 'dock' } })
    const found = ofCheck(await runChecks({ world: world() }, { kits: ['consistency'] }), 'name-clashes')
    expect(found).toEqual([expect.objectContaining({ code: 'alias-clash' })])
  })

  it('reports a prompt the world carries that the story could not use', async () => {
    await mkdir(join(directory, 'prompts', 'en', 'roleplay'), { recursive: true })
    await writeFile(join(directory, 'prompts', 'en', 'roleplay', 'persona.md'), 'Hello ${nobody}')
    const found = ofCheck(await runChecks({ world: world() }, { kits: ['consistency'] }), 'world-prompts')
    expect(found).toEqual([expect.objectContaining({ severity: 'error', code: 'prompt', where: join('prompts', 'en', 'roleplay', 'persona.md') })])
  })
})

describe('running and remembering', () => {
  const dull: Check = { id: 'dull', kit: 'quality', mode: 'judged', needs: ['model'], description: 'x', run: () => Promise.resolve([]) }
  const odd: Check = { id: 'odd', kit: 'quality', mode: 'code', needs: [], description: 'x', run: () => Promise.reject(new CheckSkipped('not now')) }

  it('lists a check that lacks what it needs or cannot run as skipped, with the reason', async () => {
    const report = await runChecks({ world: world() }, { kits: ['quality'], deep: true }, [dull, odd])
    expect(report.ran).toEqual([])
    expect(report.skipped).toEqual([{ check: 'dull', reason: 'no model is available to judge' }, { check: 'odd', reason: 'not now' }])
  })

  it('keeps the checks a model judges for a deep run, and says so', async () => {
    const report = await runChecks({ world: world() }, { kits: ['quality'] }, [dull, odd])
    expect(report.skipped).toEqual([{ check: 'dull', reason: 'judged by a model: ask for a deep check to run it' }, { check: 'odd', reason: 'not now' }])
  })

  it('stores findings in a hidden folder and says what is new and what is gone next time', async () => {
    await write(join(directory, 'variables.json'), [{ key: 'hp', name: 'HP', kind: 'number', subject: 'character' }, { key: 'health', name: 'Health', kind: 'number', subject: 'character' }])
    const first = await runChecks({ world: world() }, { kits: ['consistency'] })
    expect(first.changes).toBeUndefined()
    expect((await stat(join(directory, CHECKS_FOLDER, 'results.json'))).isFile()).toBe(true)
    await write(join(directory, 'variables.json'), [{ key: 'hp', name: 'HP', kind: 'number', subject: 'character' }])
    const second = await runChecks({ world: world() }, { kits: ['consistency'] })
    expect(second.findings).toEqual([])
    expect(second.changes).toMatchObject({ added: 0, resolved: [expect.objectContaining({ code: 'duplicate-value' })] })
  })

  it('keeps the stored result of checks that did not run', async () => {
    await runChecks({ world: world() }, { kits: ['consistency'] })
    await runChecks({ world: world() }, { ids: ['world-valid'] })
    const stored = JSON.parse(await readFile(join(directory, CHECKS_FOLDER, 'results.json'), 'utf8')) as { checks: Record<string, unknown> }
    expect(Object.keys(stored.checks).sort()).toEqual(CHECKS.filter(check => check.kit === 'consistency').map(check => check.id).sort())
  })

  it('presents counts and the worst findings first', () => {
    const report = presentReport({ at: 'now', kits: ['consistency'], ran: ['a'], skipped: [], findings: [{ check: 'a', severity: 'error', code: 'c', where: 'w', message: 'm' }, { check: 'a', severity: 'info', code: 'c', where: 'w', message: 'n' }] })
    expect(report).toMatchObject({ ok: false, counts: { error: 1, warning: 0, info: 1 }, more: 0 })
  })
})

describe('the tools', () => {
  const catalog = { find: (id: string) => Promise.resolve(id === 'harbor' ? { folder: 'harbor', directory, summary } : undefined) } as unknown as WorldCatalog
  const tools = () => checkTools(new AuthoredWorldReader(catalog), judging())
  const exec = { agent: { session: { id: authoringChatSessionId('harbor') } }, signal: new AbortController().signal } as never

  it('run the kit for the world of the chat', async () => {
    expect(tools().map(tool => tool.name)).toEqual(['check_world', 'check_card', 'check_quality', 'check_list'])
    expect(await tools()[0]!.execute({} as never, exec)).toMatchObject({ ok: true, counts: { error: 0 } })
  })

  it('list the checks with their kit, mode and needs', async () => {
    const listed = await tools()[3]!.execute({} as never, exec) as unknown as { id: string; kit: string; mode: string; needs: string[] }[]
    expect(listed.map(check => check.id)).toEqual(CHECKS.map(check => check.id))
    expect(listed.filter(check => check.kit === 'fidelity').every(check => check.needs.includes('card'))).toBe(true)
    expect(listed.filter(check => check.kit === 'consistency').every(check => check.mode === 'code' && check.needs.length === 0)).toBe(true)
  })

  it('work only in a world authoring chat', async () => {
    await expect(tools()[0]!.execute({} as never, { agent: { session: { id: 'session-x' } }, signal: new AbortController().signal } as never)).rejects.toThrow(/only in a world authoring chat/)
  })
})
