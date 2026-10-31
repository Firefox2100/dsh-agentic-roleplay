import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { ImportChoices, NormalizedCard } from '../../../src/shared/import-card.ts'
import { authoringChatSessionId } from '../../../src/shared/authoring-chat.ts'
import { loadCardEvidence } from '../../../src/host/checks/card-evidence.ts'
import { numbersOf } from '../../../src/host/checks/fidelity.ts'
import { runChecks } from '../../../src/host/checks/run.ts'
import { judging } from '../../support/checks.ts'
import { checkTools } from '../../../src/host/checks/tools.ts'
import { termsOf, shareOf } from '../../../src/host/checks/terms.ts'
import { AuthoredWorldReader } from '../../../src/host/authoring/read-tools.ts'
import { IMPORT_FOLDER } from '../../../src/host/import/store.ts'
import type { WorldCatalog } from '../../../src/host/worlds/catalog.ts'

const card: NormalizedCard = {
  sourceSpec: 'chara_card_v3', name: 'Quay', description: 'Mara keeps the ferry and is 34 years old. Her brother Joss sails the grey boat.', personality: '',
  scenario: 'Autumn on the quay: the fog never lifts and the ferry bell rings at dawn.', firstMessage: 'The ferry bell rings.', alternateGreetings: [], messageExample: '', creatorNotes: '', systemPrompt: '', postHistoryInstructions: '',
  tags: [], creator: 'someone', characterVersion: '1', ignored: { scripts: 0, extensions: [] },
  book: { name: 'Quay book', description: '', entries: [{ id: 'entry:0', title: 'The grey boat', keys: ['grey boat'], secondaryKeys: [], content: 'The grey boat was Joss\'s, painted by his father.', enabled: true, constant: false, selective: false, position: 'before_char' }] },
}
const choices: ImportChoices = { name: 'Quay', disabledEntries: [], opening: { kind: 'first' } }
const classified = {
  'field:description': { roles: ['character'], targets: [{ name: 'Mara', kind: 'character' }, { name: 'Joss', kind: 'character' }] },
  'field:scenario': { roles: ['world'], targets: [] },
  'entry:0': { roles: ['thing', 'character'], targets: [{ name: 'Joss', kind: 'character' }] },
}
const roster = [
  { kind: 'character', key: 'mara', name: 'Mara', aliases: [], player: false },
  { kind: 'character', key: 'joss', name: 'Joss', aliases: [], player: false },
]

let directory: string
const write = async (path: string, value: unknown) => { await mkdir(join(path, '..'), { recursive: true }); await writeFile(path, `${JSON.stringify(value)}\n`) }
const summary = { id: 'w1', name: 'Quay', description: '', tags: [] }
const keep = async (folder: string, cardValue: NormalizedCard, extra: Record<string, unknown>) => {
  for (const [file, value] of Object.entries({ 'card.json': cardValue, 'choices.json': choices, ...extra })) await write(join(directory, folder, file), value)
}
const run = async (version: 'current' | 'new' = 'current') => { const card = await loadCardEvidence(directory, version); return await runChecks({ world: { directory, summary } as never, ...(card === undefined ? {} : { card }) }, { kits: ['fidelity'] }) }
const found = (report: Awaited<ReturnType<typeof run>>, code: string) => report.findings.filter(finding => finding.code === code)

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'fidelity-'))
  await write(join(directory, 'world.json'), { id: 'w1', name: 'Quay' })
  await write(join(directory, 'characters', 'mara', 'character.json'), { name: 'Mara', role: 'npc', summary: 'Keeps the ferry. Thirty-four years old, 34.' })
  await write(join(directory, 'characters', 'joss', 'character.json'), { name: 'Joss', role: 'npc', summary: 'Sails the grey boat, painted by his father.' })
  await keep(IMPORT_FOLDER, card, { 'classification.json': classified, 'roster.json': roster })
})
afterEach(async () => { await rm(directory, { recursive: true, force: true }) })

describe('terms', () => {
  it('compare facts by words in Latin text and by pairs of characters in Chinese', () => {
    expect(termsOf('The grey boat was old. 灰色的船很旧')).toEqual(new Set(['grey', 'boat', '灰色', '色的', '的船', '船很', '很旧']))
    expect(shareOf(new Set(['a', 'b']), new Set(['a']))).toBe(0.5)
    expect(shareOf(new Set(), new Set(['a']))).toBe(1)
  })

  it('find the numbers of a text, not those in macros or addresses', () => {
    expect(numbersOf('She is 34, born in 1432. {{random:10,20}} see https://x.example/2024 page 7')).toEqual(['34', '1432'])
  })
})

describe('the fidelity kit', () => {
  it('is skipped without a card', async () => {
    await rm(join(directory, IMPORT_FOLDER), { recursive: true })
    const report = await runChecks({ world: { directory, summary } as never }, { kits: ['fidelity'] })
    expect(report.ran).toEqual([])
    expect(report.skipped.map(entry => entry.reason)).toEqual([...Array(4).fill('the world has no card to compare with'), 'judged by a model: ask for a deep check to run it'])
  })

  it('finds a piece the import read that nothing in the world comes from, and stops when lore holds it', async () => {
    expect(found(await run(), 'piece-uncovered')).toEqual([expect.objectContaining({ where: 'card:field:scenario', severity: 'warning' })])
    await write(join(directory, 'lore', 'quay', 'lore.json'), { title: 'The quay', kind: 'place', summary: 'Autumn fog.', body: 'Autumn on the quay: the fog never lifts and the ferry bell rings at dawn.' })
    expect(found(await run(), 'piece-uncovered')).toEqual([])
  })

  it('finds a name the card never gives, and says so once when most names are missing', async () => {
    await write(join(directory, 'characters', 'zed', 'character.json'), { name: 'Zed', role: 'npc', summary: 'Made up.' })
    expect(found(await run(), 'name-not-in-card')).toEqual([expect.objectContaining({ where: 'characters/zed' })])
    for (const key of ['a', 'b', 'c', 'd', 'e']) await write(join(directory, 'characters', key, 'character.json'), { name: `Nobody${key}`, role: 'npc', summary: 'x' })
    const report = await run()
    expect(found(report, 'name-not-in-card')).toEqual([])
    expect(found(report, 'names-elsewhere')).toHaveLength(1)
  })

  it('finds a number the card gives that the world lost', async () => {
    await write(join(directory, 'characters', 'mara', 'character.json'), { name: 'Mara', role: 'npc', summary: 'Keeps the ferry.' })
    expect(found(await run(), 'number-lost')).toEqual([expect.objectContaining({ where: 'card:field:description', message: expect.stringContaining('34') })])
  })

  describe('with a newer card waiting', () => {
    const newer: NormalizedCard = { ...card, description: `${card.description} Joss has moved to the lighthouse keeper's cottage on the headland.`, book: { ...card.book!, entries: [...card.book!.entries, { id: 'entry:1', title: 'Winters', keys: ['winter'], secondaryKeys: [], content: 'Winters on the headland bring gulls and long storms across the water.', enabled: true, constant: false, selective: false, position: 'before_char' }] } }
    beforeEach(async () => { await keep(join(IMPORT_FOLDER, 'update'), newer, {}) })

    it('is skipped when no newer card waits', async () => {
      await rm(join(directory, IMPORT_FOLDER, 'update'), { recursive: true })
      expect(await loadCardEvidence(directory, 'new')).toBeUndefined()
    })

    it('lists what the new card changed or added that the world does not say, and drops it once it does', async () => {
      const first = await run('new')
      expect(found(first, 'update-pending')).toEqual([expect.objectContaining({ where: 'card:field:description', message: expect.stringContaining('lighthouse') })])
      expect(found(first, 'update-new-piece')).toEqual([expect.objectContaining({ where: 'card:entry:1' })])
      await write(join(directory, 'characters', 'joss', 'character.json'), { name: 'Joss', role: 'npc', summary: 'Sails the grey boat, painted by his father. Moved to the lighthouse keeper cottage on the headland.' })
      expect(found(await run('new'), 'update-pending')).toEqual([])
    })
  })

  it('runs as the check_card tool, with the card of the chat\'s world', async () => {
    const catalog = { find: (id: string) => Promise.resolve(id === 'w1' ? { folder: 'w1', directory, summary } : undefined) } as unknown as WorldCatalog
    const tool = checkTools(new AuthoredWorldReader(catalog), judging()).find(entry => entry.name === 'check_card')!
    const exec = { agent: { session: { id: authoringChatSessionId('w1') } }, signal: new AbortController().signal } as never
    expect(await tool.execute({} as never, exec)).toMatchObject({ ok: true, counts: { warning: 1 } })
    await expect(tool.execute({ version: 'new' } as never, exec)).rejects.toThrow(/no newer version/)
    await expect(tool.execute({ version: 'old' } as never, exec)).rejects.toThrow(/must be one of/)
    await rm(join(directory, IMPORT_FOLDER), { recursive: true })
    await expect(tool.execute({} as never, exec)).rejects.toThrow(/no source card/)
  })
})
