import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createAuthoredEntity, replaceAuthoredEntity } from '../../../src/host/authoring/documents.ts'
import { conflictProblem } from '../../../src/host/checks/semantic.ts'
import { cosine, nearPairs, vectorsOf } from '../../../src/host/checks/similar.ts'
import { CHECKS_FOLDER } from '../../../src/host/checks/results.ts'
import { runChecks } from '../../../src/host/checks/run.ts'
import { fakeModel } from '../../support/checks.ts'

let directory: string
const write = async (path: string, value: unknown) => { await mkdir(join(path, '..'), { recursive: true }); await writeFile(path, `${JSON.stringify(value)}\n`) }
const summary = { id: 'harbor', name: 'Harbor', description: '', tags: [] as string[] }
const world = () => ({ directory, summary }) as never

/** Embeds a text by the topics it mentions, so what is near is what the test says is near. */
const TOPICS = ['health|生命', 'trust', 'gold', 'mill', 'founded', 'lighthouse']
const vectorOf = (text: string): number[] => TOPICS.map(topic => (new RegExp(topic, 'iu').test(text) ? 1 : 0))
const embedder = (calls: string[][] = []) => async (texts: readonly string[]) => { calls.push([...texts]); return { vectors: texts.map(vectorOf), model: 'fake' } }
const deciding = (asked: Record<string, unknown>[], yes: (state: Record<string, unknown>) => boolean) => async (state: Record<string, unknown>, asks: readonly { key: string }[]) => { asked.push(state); return new Map(asks.map(ask => [ask.key, yes(state) ? 0.97 : 0.02])) }

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'semantic-'))
  await write(join(directory, 'world.json'), { id: 'harbor', name: 'Harbor' })
})
afterEach(async () => { await rm(directory, { recursive: true, force: true }) })

describe('closeness', () => {
  it('is cosine, and picks the closest allowed pairs above the threshold', () => {
    expect(cosine([1, 0], [1, 0])).toBeCloseTo(1)
    expect(cosine([1, 0], [0, 1])).toBe(0)
    expect(cosine([0, 0], [1, 1])).toBe(0)
    const vectors = [[1, 0], [1, 0.1], [0, 1], [1, 0.5]]
    expect(nearPairs(vectors, () => true, 0.85, 5).map(pair => [pair.a, pair.b])).toEqual([[0, 1], [1, 3], [0, 3]])
    expect(nearPairs(vectors, (a, b) => !(a === 0 && b === 1), 0.85, 1).map(pair => [pair.a, pair.b])).toEqual([[1, 3]])
  })

  it('embeds what the world has not had embedded and keeps the rest in its dot folder', async () => {
    const calls: string[][] = []
    const model = fakeModel(() => ({}), { embed: embedder(calls) })
    expect(await vectorsOf(model, directory, ['health', 'gold'])).toEqual([vectorOf('health'), vectorOf('gold')])
    expect(await vectorsOf(model, directory, ['gold', 'trust'])).toEqual([vectorOf('gold'), vectorOf('trust')])
    expect(calls).toEqual([['health', 'gold'], ['trust']])
    expect((await readFile(join(directory, CHECKS_FOLDER, 'vectors.json'), 'utf8'))).toContain('"model":"fake"')
    expect(await vectorsOf(fakeModel(() => ({})), directory, ['gold'])).toBeUndefined()
  })

  it('forgets vectors of another size than the model now gives', async () => {
    await vectorsOf(fakeModel(() => ({}), { embed: async texts => ({ vectors: texts.map(() => [1, 0]), model: 'small' }) }), directory, ['a'])
    const calls: string[][] = []
    await vectorsOf(fakeModel(() => ({}), { embed: async texts => { calls.push([...texts]); return { vectors: texts.map(() => [1, 0, 0]), model: 'large' } } }), directory, ['a', 'b'])
    expect(calls).toEqual([['b'], ['a']])
  })
})

describe('tracked values that are one thing in other words', () => {
  const variables = [
    { key: 'shengming', name: '生命值', description: 'health of the body', kind: 'number', subject: 'character' },
    { key: 'vigor', name: 'Vigor', description: 'health and how well they are', kind: 'number', subject: 'character' },
    { key: 'trust', name: 'Trust', description: 'trust in the player', kind: 'number', subject: 'character' },
  ]

  it('asks about the close pair only and reports a yes, once', async () => {
    await write(join(directory, 'variables.json'), variables)
    const asked: Record<string, unknown>[] = []
    const model = fakeModel(() => ({}), { embed: embedder(), decide: deciding(asked, () => true) })
    const report = await runChecks({ world: world(), model }, { kits: ['consistency'], deep: 'decision', ids: ['duplicate-values-meaning'] })
    expect(asked).toHaveLength(1)
    expect(report.findings).toEqual([expect.objectContaining({ code: 'duplicate-value', message: expect.stringMatching(/shengming .*vigor/) })])
  })

  it('leaves the pairs the table already names to it, and says nothing when the model says no', async () => {
    await write(join(directory, 'variables.json'), [{ key: 'hp', name: 'HP', kind: 'number', subject: 'character' }, { key: 'health', name: 'Health', kind: 'number', subject: 'character' }])
    const asked: Record<string, unknown>[] = []
    const model = fakeModel(() => ({}), { embed: embedder(), decide: deciding(asked, () => true) })
    expect((await runChecks({ world: world(), model }, { kits: ['consistency'], deep: 'decision', ids: ['duplicate-values-meaning'] })).findings).toEqual([])
    expect(asked).toEqual([])
    await write(join(directory, 'variables.json'), variables)
    const no = fakeModel(() => ({}), { embed: embedder(), decide: deciding([], () => false) })
    expect((await runChecks({ world: world(), model: no }, { kits: ['consistency'], deep: 'decision', ids: ['duplicate-values-meaning'] })).findings).toEqual([])
  })

  it('asks the language model about the first pairs when there is no embedding provider', async () => {
    await write(join(directory, 'variables.json'), variables)
    const model = fakeModel(job => ({ reason: 'both say health', same: (job.prompt.match(/health/gu) ?? []).length >= 2 }))
    const report = await runChecks({ world: world(), model }, { kits: ['consistency'], deep: true, ids: ['duplicate-values-meaning'] })
    expect(report.findings).toEqual([expect.objectContaining({ message: expect.stringContaining('both say health') })])
  })
})

describe('things written twice', () => {
  it('asks about a pair whose names nest or whose sheets are close, only within one kind', async () => {
    await write(join(directory, 'locations', 'mill', 'location.json'), { name: 'The Mill', description: 'An old mill by the weir.' })
    await write(join(directory, 'locations', 'old-mill', 'location.json'), { name: 'Old Mill', description: 'The mill by the weir.' })
    await write(join(directory, 'characters', 'millie', 'character.json'), { name: 'Mill Hand', role: 'npc', summary: 'Works at the mill.' })
    await write(join(directory, 'locations', 'tower', 'location.json'), { name: 'Tower', description: 'A lighthouse.' })
    const asked: Record<string, unknown>[] = []
    const model = fakeModel(() => ({}), { embed: embedder(), decide: deciding(asked, state => String(state['first']).includes('weir')) })
    const report = await runChecks({ world: world(), model }, { kits: ['consistency'], deep: 'decision', ids: ['name-near'] })
    expect(asked.every(state => String(state['first']).startsWith('place') && String(state['second']).startsWith('place'))).toBe(true)
    expect(report.findings).toEqual([expect.objectContaining({ code: 'possible-duplicate', message: expect.stringMatching(/locations\/mill and locations\/old-mill/) })])
  })
})

describe('background entries that conflict', () => {
  const first = 'The lighthouse was founded in the year 1204 by the first keeper.'
  const second = 'The lighthouse was founded in the year 1311 by a guild.'

  it('needs a quote from each entry, and only then reports it', async () => {
    await write(join(directory, 'lore', 'a', 'lore.json'), { title: 'Lighthouse founding', kind: 'history', summary: 'founded', body: first })
    await write(join(directory, 'lore', 'b', 'lore.json'), { title: 'Lighthouse guild', kind: 'history', summary: 'founded', body: second })
    await write(join(directory, 'lore', 'c', 'lore.json'), { title: 'Gold', kind: 'other', summary: 'gold', body: 'Coins are minted at the mint.' })
    const model = fakeModel(() => ({ reason: 'two founding years', conflict: true, first_quote: 'founded in the year 1204', second_quote: 'founded in the year 1311' }), { embed: embedder() })
    const report = await runChecks({ world: world(), model }, { kits: ['consistency'], deep: true, ids: ['lore-conflict'] })
    expect(report.findings).toEqual([expect.objectContaining({ code: 'lore-conflict', where: 'lore/a', message: expect.stringContaining('1311') })])
    const invented = fakeModel(() => ({ reason: 'x', conflict: true, first_quote: 'built of black stone', second_quote: 'founded in the year 1311' }), { embed: embedder() })
    const refused = await runChecks({ world: world(), model: invented }, { kits: ['consistency'], deep: true, ids: ['lore-conflict'] })
    expect(refused.findings).toEqual([])
  })

  it('asks no one about entries of different times, and checks quotes exactly', async () => {
    await write(join(directory, 'lore', 'a', 'lore.json'), { title: 'Lighthouse founding', kind: 'history', summary: 'founded', body: first, ends_at: '1100-01-01' })
    await write(join(directory, 'lore', 'b', 'lore.json'), { title: 'Lighthouse guild', kind: 'history', summary: 'founded', body: second, starts_at: '1300-01-01' })
    let calls = 0
    const model = fakeModel(() => { calls += 1; return { reason: '', conflict: false, first_quote: '', second_quote: '' } }, { embed: embedder() })
    await runChecks({ world: world(), model }, { kits: ['consistency'], deep: true, ids: ['lore-conflict'] })
    expect(calls).toBe(0)
    expect(conflictProblem({ reason: '', conflict: false, first_quote: '', second_quote: '' }, first, second)).toBeUndefined()
    expect(conflictProblem({ reason: '', conflict: true, first_quote: 'in the year  1204', second_quote: 'IN THE YEAR 1311' }, first, second)).toBeUndefined()
    expect(conflictProblem({ reason: '', conflict: true, first_quote: '', second_quote: 'year 1311' }, first, second)).toMatch(/first_quote/)
    expect(conflictProblem({ reason: '', conflict: true, first_quote: 'Lighthouse founding', second_quote: 'founded in the year 1311' }, `Lighthouse founding\n${first}`, second, ['Lighthouse founding', 'Guild'])).toMatch(/not a title/)
    expect(conflictProblem({ reason: '', conflict: true, first_quote: 'founded in the year 1204', second_quote: 'founded in the year 1204' }, first, `${second} founded in the year 1204`)).toMatch(/same words/)
  })
})

describe('a write that leaves words nothing reads', () => {
  const at = () => ({ id: 'harbor', directory })

  it('is refused for the assistant, naming the fields the format reads, and allowed for the program', async () => {
    await expect(createAuthoredEntity(at(), 'location', 'dock', { name: 'Dock', descripton: 'Fog.' }, { refuseUnread: true })).rejects.toThrow(/descripton is not read.*description/s)
    await createAuthoredEntity(at(), 'location', 'dock', { name: 'Dock', description: 'Fog.' }, { refuseUnread: true })
    await expect(replaceAuthoredEntity(at(), 'location', 'dock', { name: 'Dock', note: 'x' }, { refuseUnread: true })).rejects.toThrow(/note is not read/)
    await replaceAuthoredEntity(at(), 'location', 'dock', { name: 'Dock', note: 'x' })
  })
})
