import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { ImportChoices, NormalizedCard } from '../../../src/shared/import-card.ts'
import { authoringChatSessionId } from '../../../src/shared/authoring-chat.ts'
import { READ_CHARS, cardPieces, cardTools, searchPieces } from '../../../src/host/import/card-tools.ts'
import { IMPORT_FOLDER } from '../../../src/host/import/store.ts'

const card: NormalizedCard = {
  sourceSpec: 'chara_card_v3', name: 'Quay', description: 'Mara keeps the ferry. Her brother Joss sails the grey boat.', personality: '', scenario: 'Autumn on the quay.',
  firstMessage: 'The ferry bell rings.', alternateGreetings: ['A second morning.'], messageExample: '', creatorNotes: 'Notes for the one who plays this.', systemPrompt: 'Write in the second person.', postHistoryInstructions: '',
  tags: ['harbour'], creator: 'someone', characterVersion: '1', ignored: { scripts: 0, extensions: [] },
  book: { name: 'Quay book', description: '', entries: [
    { id: 'entry:0', title: 'The grey boat', keys: ['grey boat'], secondaryKeys: [], content: 'The grey boat was Joss\'s. 灰色的船很旧。', enabled: true, constant: false, selective: false, position: 'before_char' },
    { id: 'entry:1', title: 'Tide table', keys: ['tide'], secondaryKeys: [], content: 'x'.repeat(READ_CHARS + 500), enabled: false, constant: false, selective: false, position: 'before_char' },
  ] },
}
const choices: ImportChoices = { name: 'Quay', disabledEntries: ['entry:1'], opening: { kind: 'first' } }
const classified = {
  'field:description': { roles: ['character'], targets: [{ name: 'Mara', kind: 'character' }, { name: 'Joss', kind: 'character' }] },
  'field:scenario': { roles: ['scenario'], targets: [] },
  'entry:0': { roles: ['thing', 'character'], targets: [{ name: 'Joss', kind: 'character' }] },
}
const roster = [
  { kind: 'character', key: 'mara', name: 'Mara', aliases: [], player: false },
  { kind: 'character', key: 'joss', name: 'Joss', aliases: ['the sailor'], player: false },
]

let directory: string
const worlds = { find: (id: string) => Promise.resolve(id === 'w1' ? { summary: { id: 'w1' }, directory } : undefined) } as never
const exec = (chat = authoringChatSessionId('w1')) => ({ agent: { session: { id: chat } }, signal: new AbortController().signal }) as never
const tool = (name: string, options?: { records?: boolean }) => cardTools(worlds, options).find(entry => entry.name === name)!
const run = async (name: string, args: Record<string, unknown> = {}, options?: { records?: boolean }) => await tool(name, options).execute(args as never, exec()) as never as Record<string, any>

async function keepCard(): Promise<void> {
  const folder = join(directory, IMPORT_FOLDER)
  await mkdir(folder, { recursive: true })
  for (const [file, value] of [['card.json', card], ['choices.json', choices], ['classification.json', classified], ['roster.json', roster], ['report.json', { counts: {}, prompts: [], notes: ['one note'], leftOut: { instructions: 1, templates: 0, irrelevant: 0, scripts: 0 } }]] as const) await writeFile(join(folder, file), JSON.stringify(value))
}

beforeEach(async () => { directory = await mkdtemp(join(tmpdir(), 'card-tools-')) })
afterEach(async () => { await rm(directory, { recursive: true, force: true }) })

describe('the pieces of a card', () => {
  it('are every field, greeting and entry, with what the import read and what it left', () => {
    const pieces = cardPieces(card, choices)
    expect(pieces.map(piece => piece.id)).toEqual(['field:description', 'field:scenario', 'field:first-message', 'field:greeting-1', 'field:creator-notes', 'field:system-prompt', 'entry:0', 'entry:1'])
    expect(Object.fromEntries(pieces.map(piece => [piece.id, piece.used]))).toMatchObject({ 'field:description': true, 'field:creator-notes': false, 'field:system-prompt': false, 'entry:0': true, 'entry:1': false })
    expect(pieces.find(piece => piece.id === 'entry:1')?.enabled).toBe(false)
  })

  it('are searched by phrase first, then by word, in any script', () => {
    const pieces = cardPieces(card, choices)
    expect(searchPieces(pieces, 'her brother joss', 5)[0]!.piece.id).toBe('field:description')
    expect(searchPieces(pieces, 'Joss sails', 5).map(hit => hit.piece.id)).toContain('field:description')
    expect(searchPieces(pieces, '灰色', 5)[0]!.snippet).toContain('灰色的船')
    expect(searchPieces(pieces, 'grey boat', 5).map(hit => hit.piece.id)).toContain('entry:0')
    expect(searchPieces(pieces, 'nothing like it', 5)).toEqual([])
    const byKey = searchPieces(pieces, 'tide', 5)
    expect(byKey).toHaveLength(1)
    expect(byKey[0]).toMatchObject({ in: 'title or keys', snippet: 'title: Tide table; keys: tide' })
    expect(searchPieces(pieces, 'Her brother', 5)[0]!.in).toBe('text')
    expect(searchPieces(pieces, '  ', 5)).toEqual([])
  })
})

describe('the card tools', () => {
  it('say so when the world holds no card, which is how removing the .import folder turns them off', async () => {
    await expect(run('card_overview')).rejects.toThrow(/no source card/)
    await keepCard()
    await expect(run('card_overview')).resolves.toBeDefined()
    await rm(join(directory, IMPORT_FOLDER), { recursive: true })
    await expect(run('card_search', { query: 'Mara' })).rejects.toThrow(/no source card/)
  })

  it('work only in a world authoring chat, for a world that exists', async () => {
    await keepCard()
    await expect(tool('card_overview').execute({} as never, exec('session-x'))).rejects.toThrow(/only in a world authoring chat/)
    await expect(tool('card_overview').execute({} as never, exec(authoringChatSessionId('gone')))).rejects.toThrow(/no longer exists/)
  })

  it('give an overview with what the import took each piece to be and made of it', async () => {
    await keepCard()
    const overview = await run('card_overview')
    expect(overview['card']).toMatchObject({ name: 'Quay', creator: 'someone' })
    const piece = (id: string) => overview['pieces'].find((entry: { id: string }) => entry.id === id)
    expect(piece('field:description')).toMatchObject({ readByTheImport: true, takenToBe: ['character'], madeInto: ['Mara', 'Joss'] })
    expect(piece('field:creator-notes')).toMatchObject({ readByTheImport: false, takenToBe: [], madeInto: [] })
    expect(piece('entry:1')).toMatchObject({ switchedOnInCard: false })
    expect(overview['imported'].map((entity: { name: string }) => entity.name)).toEqual(['Mara', 'Joss'])
    expect(overview['importNotes']).toEqual(['one note'])
  })

  it('search, and read a long piece in turns', async () => {
    await keepCard()
    const found = await run('card_search', { query: 'brother', limit: 3 })
    expect(found['hits'][0]).toMatchObject({ piece: 'field:description' })
    const first = await run('card_read', { piece: 'entry:1' })
    expect(first).toMatchObject({ from: 0, to: READ_CHARS, of: READ_CHARS + 500, next: READ_CHARS })
    const rest = await run('card_read', { piece: 'entry:1', offset: first['next'] })
    expect(rest['text']).toHaveLength(500)
    expect(rest['next']).toBeUndefined()
    await expect(run('card_read', { piece: 'entry:9' })).rejects.toThrow(/no piece "entry:9"/)
    await expect(run('card_search', { query: 'Mara', version: 'later' })).rejects.toThrow(/version.*current.*new/)
  })

  it('say which pieces a character was made from, the ones about it first, and what a name the import did not make is mentioned in', async () => {
    await keepCard()
    const joss = await run('card_origin', { name: 'the sailor' })
    expect(joss).toMatchObject({ name: 'Joss', madeByTheImport: true })
    expect(joss['usedPieces']).toEqual([
      { piece: 'field:description', label: 'description', how: 'about it', takenToBe: ['character'] },
      { piece: 'entry:0', label: 'entry “The grey boat”', how: 'about it', takenToBe: ['thing', 'character'] },
    ])
    const unknown = await run('card_origin', { name: 'ferry' })
    expect(unknown).toMatchObject({ madeByTheImport: false })
    expect(unknown['mentions'].map((hit: { piece: string }) => hit.piece)).toContain('field:description')
  })

  it('leave the import\'s records out when asked to, and still answer from the card', async () => {
    await keepCard()
    const overview = await run('card_overview', {}, { records: false })
    expect(overview['pieces'][0]).not.toHaveProperty('takenToBe')
    expect(overview).not.toHaveProperty('imported')
    expect(await run('card_origin', { name: 'Joss' }, { records: false })).toMatchObject({ madeByTheImport: false })
  })
})
