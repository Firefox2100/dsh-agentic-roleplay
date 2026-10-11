import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { readCard } from '../../../src/host/import/card.ts'
import { ImportStateError, build, endReview, finish, importPhase, isReviewing, markReady, survey } from '../../../src/host/import/run-import.ts'
import { ImportStore } from '../../../src/host/import/store.ts'
import { v3Card } from '../../support/cards.ts'
import { fakeContext } from '../../support/jobs.ts'

let root: string
let world: string

const book = { entries: [
  { comment: 'Tam', content: 'Old Tam keeps the lighthouse and writes the ledger.', keys: ['Tam'] },
  { comment: 'The Lighthouse', content: 'A white tower on the point, with a cellar.', keys: [] },
  { comment: 'Style', content: 'Write short answers.', keys: [] },
  { comment: 'History', content: 'The harbour was founded by net makers.', keys: [] },
  { comment: 'Skipped', content: 'Switched off by the person.', keys: [] },
] }

const answers = (job: { prompt: string; persona: string }): unknown => {
  const prompt = job.prompt
  if (job.persona.startsWith('You read one piece')) {
    if (prompt.includes('Title: Tam')) return { roles: ['character'], targets: [{ name: 'Old Tam', kind: 'character' }] }
    if (prompt.includes('Title: The Lighthouse')) return { roles: ['place'], targets: [{ name: 'The Lighthouse', kind: 'place' }] }
    if (prompt.includes('Title: Style')) return { roles: ['instruction'], targets: [] }
    if (prompt.includes('Title: History')) return { roles: ['world'], targets: [] }
    if (prompt.includes('Piece: scenario')) return { roles: ['scenario'], targets: [] }
    return { roles: ['irrelevant'], targets: [] }
  }
  if (job.persona.startsWith('You make the final list')) return { characters: [{ name: 'Old Tam', aliases: ['Tam'] }], places: [{ name: 'The Lighthouse', aliases: [] }], factions: [], things: [] }
  if (prompt.includes('Make the character')) return { tier: 'principal', kind: 'person', summary: 'Keeps the light.', personality: 'Gruff.', background: '', appearance: '', speech: { style: '', examples: [] }, start: { location: 'The Lighthouse' } }
  if (prompt.includes('Make the place')) return { description: 'A white tower.' }
  if (job.persona.startsWith('You turn one piece')) return { entries: [{ title: 'Founding', kind: 'history', summary: 'Net makers founded it.', body: 'The harbour was founded by net makers.', subjects: [{ kind: 'place', name: 'The Lighthouse' }] }] }
  return { description: 'A harbour town.', tags: ['harbour'] }
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'run-import-'))
  world = join(root, 'worlds', 'harbour')
  await mkdir(world, { recursive: true })
  await writeFile(join(world, 'world.json'), JSON.stringify({ id: 'w1', name: 'Test Harbour', description: '', metadata: { tags: [] } }))
  const card = readCard(Buffer.from(JSON.stringify(v3Card({ character_book: book }))), 'x.json')
  const store = new ImportStore(() => root)
  const made = await store.create(card, Buffer.from('png'))
  await store.choose(made.id, { name: 'Test Harbour', disabledEntries: ['entry:4'], opening: { kind: 'first' } })
  await store.adopt(made.id, world)
  await markReady(world)
})
afterEach(async () => { await rm(root, { recursive: true, force: true }) })

describe('the steps of an import', () => {
  it('runs in order: the survey says what each piece is and lists who is in the world, the build writes them, the finish puts them in the world', async () => {
    expect(await importPhase(world)).toBe('ready')
    const summary = await survey(fakeContext(answers), world)
    expect(summary).toMatchObject({ pieces: 7, roles: { character: 1, place: 1, instruction: 1, world: 1, scenario: 1, irrelevant: 2 }, leftOut: 3, roster: { characters: ['Old Tam'], places: ['The Lighthouse'] }, playable: undefined, notes: [] })
    expect(await importPhase(world)).toBe('surveyed')
    const built = await build(fakeContext(answers), world)
    expect(built).toEqual({ characters: 1, places: 1, factions: 0, things: 0, lore: 1, notes: [] })
    expect(await importPhase(world)).toBe('built')
    const done = await finish(fakeContext(answers), world)
    expect(done).toMatchObject({ ok: true, report: { counts: { characters: 1, places: 1, lore: 1 }, hasPlayableCharacter: false, cover: true, opening: 'imported' } })
    expect(await importPhase(world)).toBe('done')
    expect(await isReviewing(world)).toBe(true)
    await endReview(world)
    expect(await isReviewing(world)).toBe(false)
    expect(await importPhase(world)).toBe('done')
    expect(JSON.parse(await readFile(join(world, 'characters', 'old-tam', 'character.json'), 'utf8'))).toMatchObject({ role: 'npc', start: { location: 'the-lighthouse' } })
    expect(JSON.parse(await readFile(join(world, 'world.json'), 'utf8'))).toMatchObject({ description: 'A harbour town.', opening_message: 'The fog lifts from the pier.', cover_media_id: 'cover' })
    expect((await readdir(world)).sort()).toEqual(['.import', 'characters', 'lore', 'locations', 'media', 'world.json'].sort())
  })

  it('leaves out the entries that were switched off, and the instructions: nothing about them reaches a later step', async () => {
    const ctx = fakeContext(answers)
    await survey(ctx, world)
    expect(ctx.asked.some(asked => asked.prompt.includes('Switched off'))).toBe(false)
    const later = fakeContext(answers)
    await build(later, world)
    expect(later.asked.some(asked => asked.prompt.includes('Write short answers'))).toBe(false)
  })

  it('refuses a step that is out of order, or when no card is waiting', async () => {
    await expect(build(fakeContext(answers), world)).rejects.toThrow(/the build cannot run now: the import is at "ready"; it needs "surveyed" or "built"/)
    await expect(finish(fakeContext(answers), world)).rejects.toThrow(ImportStateError)
    await rm(join(world, '.import'), { recursive: true })
    await expect(survey(fakeContext(answers), world)).rejects.toThrow(/no card is waiting/)
    expect(await importPhase(world)).toBeUndefined()
  })

  it('can be surveyed again, which forgets what was built', async () => {
    await survey(fakeContext(answers), world)
    await build(fakeContext(answers), world)
    await survey(fakeContext(answers), world)
    expect(await importPhase(world)).toBe('surveyed')
    expect(await readdir(join(world, '.import'))).not.toContain('extracted.json')
  })

  it('does not finish when the world would not start with what was built, and says why', async () => {
    await survey(fakeContext(answers), world)
    await build(fakeContext(answers), world)
    const file = join(world, '.import', 'extracted.json')
    const extracted = JSON.parse(await readFile(file, 'utf8'))
    extracted.characters[0].start.location = 'nowhere'
    await writeFile(file, JSON.stringify(extracted))
    const result = await finish(fakeContext(answers), world)
    expect(result.ok).toBe(false)
    expect(await importPhase(world)).toBe('built')
    expect(await readdir(world)).not.toContain('characters')
  })
})
