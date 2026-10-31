import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { runChecks } from '../../../src/host/checks/run.ts'
import { comparisonProblem } from '../../../src/host/checks/fidelity.ts'
import { verdictOf } from '../../../src/host/checks/judge.ts'
import { loadCardEvidence } from '../../../src/host/checks/card-evidence.ts'
import { IMPORT_FOLDER } from '../../../src/host/import/store.ts'
import { fakeModel } from '../../support/checks.ts'

let directory: string
const write = async (path: string, value: unknown) => { await mkdir(join(path, '..'), { recursive: true }); await writeFile(path, `${JSON.stringify(value)}\n`) }
const summary = { id: 'harbor', name: 'Harbor', description: '', tags: [] as string[] }
const quick = async (ids?: string[]) => await runChecks({ world: { directory, summary } as never }, { kits: ['quality'], ...(ids === undefined ? {} : { ids }) })

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'quality-'))
  await write(join(directory, 'world.json'), { id: 'harbor', name: 'Harbor' })
  await write(join(directory, 'locations', 'inn', 'location.json'), { name: 'The Inn', description: 'Low beams, a fire, a smell of tar and bread.' })
  await write(join(directory, 'locations', 'dock', 'location.json'), { name: 'The Dock' })
  await write(join(directory, 'characters', 'clara', 'character.json'), { name: 'Clara', role: 'playable', tier: 'principal', summary: 'Innkeeper.', start: { location: 'inn' } })
  await write(join(directory, 'characters', 'tam', 'character.json'), { name: 'Tam', role: 'npc', tier: 'principal', summary: 'Innkeeper.', personality: 'Dry.', start: { location: 'inn' } })
})
afterEach(async () => { await rm(directory, { recursive: true, force: true }) })

describe('the quality kit, decided by the program', () => {
  it('finds a cast of bare summaries, characters written twice, bare places and a world with nothing to say about itself', async () => {
    const report = await quick()
    const codes = report.findings.map(finding => `${finding.code} ${finding.where}`)
    expect(codes).toEqual(expect.arrayContaining(['sheet-summary-only characters/clara', 'same-summary characters/tam', 'place-undescribed locations/dock', 'no-description world.json', 'no-tags world.json', 'no-opening world.json']))
    expect(report.findings.some(finding => finding.code === 'no-playable')).toBe(false)
  })

  it('names a world nobody can play', async () => {
    await write(join(directory, 'characters', 'clara', 'character.json'), { name: 'Clara', role: 'npc', tier: 'principal', summary: 'Innkeeper.', start: { location: 'inn' } })
    expect((await quick(['quality-cast'])).findings.map(finding => finding.code)).toContain('no-playable')
  })
})

describe('the checks a model judges', () => {
  const deep = async (model: ReturnType<typeof fakeModel>, ids: string[]) => await runChecks({ world: { directory, summary } as never, model }, { kits: ['quality'], deep: true, ids })

  it('ask the language model whether a sheet is enough when no decision model is set, and report the thin ones with its reason', async () => {
    const asked: string[] = []
    const report = await deep(fakeModel(job => { asked.push(job.prompt); return job.prompt.includes('Clara') ? { reason: 'only a job title', playable: false } : { reason: 'ok', playable: true } }), ['sheet-playable'])
    expect(asked).toHaveLength(2)
    expect(report.findings).toEqual([expect.objectContaining({ code: 'sheet-thin', where: 'characters/clara', message: expect.stringContaining('only a job title') })])
  })

  it('let a decision model answer when it is sure, and only ask the language model about the rest', async () => {
    const probabilities: Record<string, number> = { Clara: 0.05, Tam: 0.5 }
    const asked: string[] = []
    const model = fakeModel(job => { asked.push(job.prompt); return { reason: 'fine', playable: true } }, {
      confidence: 0.7,
      decide: (state) => Promise.resolve(new Map([['playable', probabilities[/name: (\w+)/.exec(String(state['sheet']))![1]!]!]])),
    })
    const report = await deep(model, ['sheet-playable'])
    expect(asked).toHaveLength(1)
    expect(asked[0]).toContain('Tam')
    expect(report.findings).toEqual([expect.objectContaining({ where: 'characters/clara' })])
  })

  it('fall back to the language model when the decision model fails', async () => {
    const model = fakeModel(() => ({ reason: 'fine', playable: true }), { decide: () => Promise.reject(new Error('no service')) })
    expect((await deep(model, ['sheet-playable'])).findings).toEqual([])
  })

  it('verdictOf says who decided', async () => {
    expect(await verdictOf(fakeModel(() => undefined, { decide: () => Promise.resolve(new Map([['k', 0.99]])) }), {}, 'k', 'q', () => Promise.resolve(false))).toEqual({ yes: true, by: 'decision' })
    expect(await verdictOf(fakeModel(() => undefined), {}, 'k', 'q', () => Promise.resolve(false))).toEqual({ yes: false, by: 'language' })
  })

  it('report gaps about the thing named by its key, its name or its kind and key, and about the world when it is none of them', async () => {
    const of = async (about: string) => (await deep(fakeModel(() => ({ gaps: [{ about, gap: 'The dock has nobody and nothing to do.', fill: 'Put a ferryman there.' }] })), ['world-gaps'])).findings
    for (const about of ['dock', 'The Dock', 'place dock']) expect(await of(about)).toEqual([expect.objectContaining({ code: 'gap', where: 'dock', hint: 'Put a ferryman there.' })])
    expect(await of('the whole thing')).toEqual([expect.objectContaining({ where: '(the world)' })])
  })

  it('list a gap with no words as a failure of that check, and keep what the others found', async () => {
    const report = await deep(fakeModel(() => ({ gaps: [{ about: 'dock', gap: '', fill: '' }] })), ['world-gaps', 'sheet-playable'])
    expect(report.skipped).toEqual([{ check: 'world-gaps', reason: expect.stringMatching(/^it failed: refused: every gap says/) }])
    expect(report.ran).toEqual(['sheet-playable'])
  })
})

describe('the comparison with the card', () => {
  const source = 'Mara keeps the ferry. She is 34 years old.'
  const document = 'Keeps the ferry. Thirty years old.'

  it('refuses a fact whose quote is not where it is said to be', () => {
    expect(comparisonProblem({ dropped: [{ fact: 'age', quote: 'She is 34 years old.' }], invented: [{ fact: 'age', quote: 'Thirty years old.' }] }, source, document)).toBeUndefined()
    expect(comparisonProblem({ dropped: [{ fact: 'age', quote: 'She is 35' }], invented: [] }, source, document)).toMatch(/passage of the source/)
    expect(comparisonProblem({ dropped: [], invented: [{ fact: 'x', quote: 'She is 34 years old.' }] }, source, document)).toMatch(/passage of the document/)
    expect(comparisonProblem({ dropped: Array(7).fill({ fact: 'f', quote: 'Mara keeps' }), invented: [] }, source, document)).toMatch(/at most/)
  })

  it('is run for each document made from the card, and reports what was dropped and invented', async () => {
    const card = { sourceSpec: 'chara_card_v3', name: 'Quay', description: 'Mara keeps the ferry. She is 34 years old.', personality: '', scenario: '', firstMessage: '', alternateGreetings: [], messageExample: '', creatorNotes: '', systemPrompt: '', postHistoryInstructions: '', tags: [], creator: 'x', characterVersion: '1', ignored: { scripts: 0, extensions: [] } }
    for (const [file, value] of Object.entries({ 'card.json': card, 'choices.json': { name: 'Quay', disabledEntries: [], opening: { kind: 'none' } }, 'classification.json': { 'field:description': { roles: ['character'], targets: [{ name: 'Mara', kind: 'character' }] } }, 'roster.json': [{ kind: 'character', key: 'mara', name: 'Mara', aliases: [], player: false }] })) await write(join(directory, IMPORT_FOLDER, file), value)
    await write(join(directory, 'characters', 'mara', 'character.json'), { name: 'Mara', role: 'npc', summary: 'Keeps the ferry. Thirty years old.' })
    const card2 = await loadCardEvidence(directory, 'current')
    const model = fakeModel(job => {
      expect(job.prompt).toContain('She is 34 years old.')
      return { dropped: [{ fact: 'her age is 34', quote: 'She is 34 years old.' }], invented: [{ fact: 'she is thirty', quote: 'Thirty years old.' }] }
    })
    const report = await runChecks({ world: { directory, summary } as never, card: card2!, model }, { kits: ['fidelity'], deep: true, ids: ['card-fidelity'] })
    expect(report.findings.map(finding => `${finding.code} ${finding.where}`)).toEqual(['fact-dropped characters/mara', 'fact-invented characters/mara'])
  })
})
