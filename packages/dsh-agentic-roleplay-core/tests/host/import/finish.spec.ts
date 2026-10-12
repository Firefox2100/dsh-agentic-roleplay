import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { readPngMetadata } from '../../../src/host/images/png-metadata.ts'
import { readCard } from '../../../src/host/import/card.ts'
import { emptyExtracted } from '../../../src/host/import/extract.ts'
import { alternateOpenings, breakParentCircles, finishImport, openingMessage, replacePlayer, shareThePlaces } from '../../../src/host/import/finish.ts'
import type { SourceItem } from '../../../src/host/import/items.ts'
import { defaultChoices } from '../../../src/host/import/store.ts'
import type { Classified, Roster } from '../../../src/host/import/survey.ts'
import { v3Card } from '../../support/cards.ts'
import { fakeContext } from '../../support/jobs.ts'

let directory: string
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64')
const card = readCard(Buffer.from(JSON.stringify(v3Card({ creator: 'Someone' }))), 'x.json')
const roster: Roster = [{ kind: 'character', key: 'tam', name: 'Old Tam', aliases: [], player: false }, { kind: 'place', key: 'light', name: 'The Lighthouse', aliases: [], player: false }]
const items: SourceItem[] = [{ id: 'field:scenario', label: 'scenario', title: '', keys: [], text: 'Autumn in the town.' }, { id: 'entry:0', label: 'entry', title: 'Style', keys: [], text: 'Write short.' }]
const classified: Classified = { 'field:scenario': { roles: ['scenario'], targets: [] }, 'entry:0': { roles: ['instruction'], targets: [] } }
const extracted = () => ({
  ...emptyExtracted(),
  characters: [{ id: 'tam', name: 'Old Tam', role: 'npc', kind: 'person', tier: 'principal', summary: 'Keeps the light.', start: { location: 'light' } }],
  locations: [{ id: 'light', name: 'The Lighthouse', description: 'A tower.' }],
  lore: [{ id: 'founding', title: 'Founding', kind: 'history', summary: 's', body: 'The harbour was founded.', subjects: [{ kind: 'location', id: 'light' }] }],
  notes: ['Mira: not written'],
})
const input = (overrides: Record<string, unknown> = {}) => ({ directory, card, choices: defaultChoices(card), roster, items, classified, extracted: extracted(), notes: ['classifying failed once'], ...overrides })
const read = async (path: string) => JSON.parse(await readFile(join(directory, path), 'utf8')) as Record<string, unknown>

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'finish-'))
  await writeFile(join(directory, 'world.json'), JSON.stringify({ id: 'w1', name: 'Test Harbour', description: '', metadata: { tags: [] } }))
})
afterEach(async () => { await rm(directory, { recursive: true, force: true }) })

describe('the opening of the world', () => {
  it('is the chosen text as plain paragraphs: no emphasis marks, tags or code fences, the card\'s name for the character and a word for the player', () => {
    expect(openingMessage('*The fog* lifts.\r\n\r\n\r\n**{{char}}** waves at {{user}}.<br>```\ncode```', 'Tam')).toBe('The fog lifts.\n\nTam waves at the player.code')
    expect(openingMessage('{{user}} waits.', 'Tam', 'Ana')).toBe('Ana waits.')
    expect(openingMessage('2 * 3 * 4', 'Tam')).toBe('2 * 3 * 4')
  })
})

describe('the player in the documents', () => {
  it('is named by the character the player plays, or by a plain word, wherever the placeholder stands', () => {
    const value = { a: '{{user}} waits.', b: ['to {{user}}', { c: '{{user}}等待' }], d: 3 }
    replacePlayer(value)
    expect(value).toEqual({ a: 'the player waits.', b: ['to the player', { c: '玩家等待' }], d: 3 })
    const named = { a: '{{user}} waits.' }
    replacePlayer(named, 'Ana')
    expect(named.a).toBe('Ana waits.')
  })
})

describe('places that contain each other', () => {
  it('lets every character know the places and the ways between them, unless its file says what it knows', () => {
    const characters: Record<string, unknown>[] = [{ id: 'a' }, { id: 'b', knowledge: { locations: ['x'] } }]
    shareThePlaces(characters, [{ id: 'x', exits: [{ to: 'y' }, { to: 'z', one_way: true }] }, { id: 'y' }, { id: 'z' }])
    expect(characters[0]!['knowledge']).toEqual({ locations: ['x', 'y', 'z'], exits: [{ from: 'x', to: 'y' }, { from: 'y', to: 'x' }, { from: 'x', to: 'z' }] })
    expect(characters[1]!['knowledge']).toEqual({ locations: ['x'] })
  })

  it('are untangled by taking the parent off the place that closes the circle', () => {
    const places = [{ id: 'a', name: 'A', parent: 'b' }, { id: 'b', name: 'B', parent: 'c' }, { id: 'c', name: 'C', parent: 'a' }, { id: 'd', name: 'D', parent: 'a' }]
    const notes = breakParentCircles(places)
    expect(notes.length).toBeGreaterThan(0)
    expect(places.some(place => place.id === 'a' && 'parent' in place) && places.some(place => place.id === 'c' && 'parent' in place) && places.some(place => place.id === 'b' && 'parent' in place)).toBe(false)
    expect(places.find(place => place.id === 'd')?.parent).toBe('a')
  })
})

describe('the other greetings of a card', () => {
  const greeted = readCard(Buffer.from(JSON.stringify(v3Card({ first_mes: 'The fog lifts.', alternate_greetings: ['Night falls on the pier.', '  ', 'Morning at the dock, {{user}}.'] }))), 'x.json')

  it('become openings to choose from, except the one that was chosen', () => {
    expect(alternateOpenings(greeted, { kind: 'first' }, 'Arthur')).toEqual([{ title: 'Alternate 1', text: 'Night falls on the pier.' }, { title: 'Alternate 3', text: 'Morning at the dock, Arthur.' }])
    expect(alternateOpenings(greeted, { kind: 'alternate', index: 0 })).toEqual([{ title: 'First message', text: 'The fog lifts.' }, { title: 'Alternate 3', text: expect.stringContaining('Morning at the dock') }])
    expect(alternateOpenings(greeted, { kind: 'none' })).toEqual([])
  })
})

describe('finishing an import', () => {
  it('moves the documents in, all valid, and fills in the world\'s own file: description and tags from one call, the chosen opening, the creator and the cover', async () => {
    const ctx = fakeContext(() => ({ description: 'A fishing town in autumn.', tags: ['harbour', 'harbour', 'autumn'], starting_time: '1912-10-04T08:00:00' }))
    const result = await finishImport(ctx, input({ picture: PNG }))
    expect(result).toMatchObject({ ok: true, report: {
      counts: { characters: 1, places: 1, factions: 0, things: 0, lore: 1 }, hasPlayableCharacter: false, opening: 'imported', cover: true, portrait: true,
      leftOut: { instructions: 1, templates: 0, irrelevant: 0, scripts: 0 }, notes: ['classifying failed once', 'Mira: not written'],
    } })
    expect(await read('characters/tam/character.json')).toMatchObject({ id: 'tam', name: 'Old Tam' })
    expect(await read('lore/founding/lore.json')).toMatchObject({ title: 'Founding' })
    expect(await read('world.json')).toEqual({
      id: 'w1', name: 'Test Harbour', description: 'A fishing town in autumn.', starting_time: '1912-10-04T08:00:00', metadata: { tags: ['harbour', 'autumn'] }, opening_message: 'The fog lifts from the pier.', author: { name: 'Someone' }, cover_media_id: 'cover', alternate_openings: [{ title: 'Alternate 1', text: 'A second morning.' }],
    })
    expect(await readFile(join(directory, 'media', 'manifest.jsonl'), 'utf8')).toBe('{"id":"cover","file":"media/files/cover.png"}\n')
    expect(await readdir(join(directory, '.import'))).toEqual(['report.json'])
    const portrait = await readFile(join(directory, 'images', 'characters', 'tam', 'reference.png'))
    expect(readPngMetadata(portrait)).toMatchObject({ purpose: 'reference', origin: 'uploaded', subjects: [{ kind: 'character', localId: 'tam', name: 'Old Tam' }] })
  })

  it('takes the description from the card when the call fails, and says so; no opening is written when none was chosen', async () => {
    const ctx = fakeContext(() => { throw new Error('no answer') })
    const result = await finishImport(ctx, input({ choices: { ...defaultChoices(card), opening: { kind: 'none' } } }))
    expect(result).toMatchObject({ ok: true, report: { opening: 'none', cover: false } })
    expect(result.ok && result.report.notes.at(-1)).toMatch(/taken from the card as it is: refused|no answer/)
    expect(await read('world.json')).toMatchObject({ description: 'Autumn in the town.', metadata: { tags: ['harbour'] } })
    expect(await read('world.json')).not.toHaveProperty('opening_message')
  })

  it('writes nothing, and says what is wrong, when the world would not start with it', async () => {
    const broken = extracted()
    broken.characters[0]!.start = { location: 'nowhere' }
    const result = await finishImport(fakeContext(() => ({ description: 'x', tags: [] })), input({ extracted: broken }))
    expect(result.ok).toBe(false)
    expect(!result.ok && result.problems.join('\n')).toMatch(/nowhere/)
    expect((await readdir(directory)).sort()).toEqual(['.import', 'world.json'])
    expect(await read('world.json')).toMatchObject({ description: '' })
    expect(await readdir(join(directory, '.import'))).toEqual([])
  })

  it('refuses a world that already has something in it', async () => {
    await mkdir(join(directory, 'characters', 'x'), { recursive: true })
    await writeFile(join(directory, 'characters', 'x', 'character.json'), '{"name":"X"}')
    const result = await finishImport(fakeContext(() => ({})), input())
    expect(result).toEqual({ ok: false, problems: [expect.stringContaining('only fills an empty world')] })
  })
})
