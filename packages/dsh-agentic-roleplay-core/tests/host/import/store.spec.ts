import { mkdir, mkdtemp, readdir, rm, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { readCard } from '../../../src/host/import/card.ts'
import { ImportNotFoundError, ImportStore, choiceProblems, defaultChoices, openingText, parseChoices, readImportFolder } from '../../../src/host/import/store.ts'
import { InvalidEditProblems } from '../../../src/shared/world-state.ts'
import { pngWithCard, v3Card } from '../../support/cards.ts'

let root: string
let store: ImportStore
const card = () => readCard(pngWithCard({ ccv3: v3Card({ alternate_greetings: ['', 'Second.'], character_book: { entries: [{ comment: 'On', content: 'a', keys: [] }, { comment: 'Off', content: 'b', keys: [], enabled: false }] } }) }), 'x.png')

beforeEach(async () => { root = await mkdtemp(join(tmpdir(), 'import-')); store = new ImportStore(() => root) })
afterEach(async () => { await rm(root, { recursive: true, force: true }) })

describe('what is offered to begin with', () => {
  it('is the name of the card, the entries the card left off, and its first message', () => {
    expect(defaultChoices(card())).toEqual({ name: 'Test Harbour', disabledEntries: ['entry:1'], opening: { kind: 'first' } })
  })

  it('falls back to the first alternate greeting that says something, or to none', () => {
    expect(defaultChoices({ ...card(), firstMessage: ' ' }).opening).toEqual({ kind: 'alternate', index: 1 })
    expect(defaultChoices({ ...card(), firstMessage: '', alternateGreetings: ['', ' '] }).opening).toEqual({ kind: 'none' })
  })

  it('names the opening a choice stands for', () => {
    expect(openingText(card(), { kind: 'first' })).toBe('The fog lifts from the pier.')
    expect(openingText(card(), { kind: 'alternate', index: 1 })).toBe('Second.')
    expect(openingText(card(), { kind: 'alternate', index: 0 })).toBeUndefined()
    expect(openingText(card(), { kind: 'none' })).toBeUndefined()
  })
})

describe('choices', () => {
  it('are read from a body field by field, refusing what is not the right shape', () => {
    expect(parseChoices({ name: ' W ', disabledEntries: ['entry:1', 'entry:1'], opening: { kind: 'alternate', index: 1 } })).toEqual({ name: 'W', disabledEntries: ['entry:1'], opening: { kind: 'alternate', index: 1 } })
    expect(() => parseChoices({ name: 4, disabledEntries: 'x', opening: { kind: 'sideways' } })).toThrow(InvalidEditProblems)
    expect(() => parseChoices(null)).toThrow(InvalidEditProblems)
  })

  it('cannot be used when the name is blank, an entry is unknown or the opening is empty', () => {
    expect(choiceProblems(card(), { name: 'W', disabledEntries: ['entry:0'], opening: { kind: 'first' } })).toEqual([])
    expect(choiceProblems(card(), { name: ' ', disabledEntries: ['entry:9'], opening: { kind: 'alternate', index: 0 } })).toEqual(['the world needs a name', 'there is no entry "entry:9"', 'the opening chosen is empty or does not exist'])
  })
})

describe('an uploaded card waiting to become a world', () => {
  it('is kept with its picture and its choices, and read back', async () => {
    const made = await store.create(card(), Buffer.from('picture'))
    expect(made).toMatchObject({ hasAvatar: true, choices: { name: 'Test Harbour' }, card: { name: 'Test Harbour' } })
    expect(await store.read(made.id)).toEqual(made)
    const chosen = await store.choose(made.id, { name: 'Renamed', disabledEntries: ['entry:0'], opening: { kind: 'none' } })
    expect(chosen.choices).toEqual({ name: 'Renamed', disabledEntries: ['entry:0'], opening: { kind: 'none' } })
  })

  it('refuses choices that cannot be used, and an id that is not an import, and keeps what was chosen before', async () => {
    const made = await store.create(card())
    expect(made.hasAvatar).toBe(false)
    await expect(store.choose(made.id, { name: '', disabledEntries: [], opening: { kind: 'none' } })).rejects.toThrow(InvalidEditProblems)
    expect((await store.read(made.id)).choices.name).toBe('Test Harbour')
    await expect(store.read('../x')).rejects.toThrow(ImportNotFoundError)
    await expect(store.read('3f1c1d6e-6f6b-4f55-9d0f-0d6a1c2b3a4d')).rejects.toThrow(ImportNotFoundError)
  })

  it('is discarded, or moved into the world it became as .import', async () => {
    const first = await store.create(card())
    const second = await store.create(card(), Buffer.from('p'))
    await store.discard(first.id)
    await expect(store.read(first.id)).rejects.toThrow(ImportNotFoundError)
    const world = join(root, 'worlds', 'harbour')
    await mkdir(world, { recursive: true })
    await store.adopt(second.id, world)
    expect(await readdir(join(world, '.import'))).toEqual(['card.json', 'choices.json', 'picture.png'])
    expect((await readImportFolder(join(world, '.import'))).card.name).toBe('Test Harbour')
    await expect(store.read(second.id)).rejects.toThrow(ImportNotFoundError)
  })

  it('forgets uploads that nobody started an import from, a day later', async () => {
    const old = await store.create(card())
    const stale = new Date(Date.now() - 25 * 3_600_000)
    await utimes(join(root, 'imports', old.id), stale, stale)
    await writeFile(join(root, 'imports', 'unrelated.txt'), 'kept')
    const fresh = await store.create(card())
    expect((await readdir(join(root, 'imports'))).sort()).toEqual([fresh.id, 'unrelated.txt'].sort())
  })
})
