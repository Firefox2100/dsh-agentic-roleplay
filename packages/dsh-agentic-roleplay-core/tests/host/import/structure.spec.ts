import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { readCard } from '../../../src/host/import/card.ts'
import { itemise } from '../../../src/host/import/items.ts'
import { importPhase } from '../../../src/host/import/run-import.ts'
import { importWithoutModel } from '../../../src/host/import/start-import.ts'
import { ImportStore, defaultChoices } from '../../../src/host/import/store.ts'
import { structureOnly } from '../../../src/host/import/structure.ts'
import type { RoleplayRoot } from '../../../src/host/storage/roleplay-root.ts'
import { WorldCatalog } from '../../../src/host/worlds/catalog.ts'
import { v3Card } from '../../support/cards.ts'

const cardWith = (data: Record<string, unknown> = {}) => readCard(Buffer.from(JSON.stringify(v3Card({
  name: 'Mira Voss', description: 'A ferry pilot with news from the river. She keeps a worn logbook.\n\nShe is always tired.', personality: 'Dry and tired.', scenario: 'Dusk at the landing.',
  mes_example: '<START>\nMira: Tide waits for no one.\n{{user}}: Fair enough.', system_prompt: 'Write in short, plain sentences.', post_history_instructions: 'Keep ${secrets} out of it.', ...data,
}))), 'x.json')

describe('what a card is made into without a model', () => {
  it('is its own character, its lorebook as lore for the game master, and its instructions as the style, word for word', () => {
    const card = cardWith()
    const choices = defaultChoices(card)
    const items = itemise(card, choices)
    const { classified, roster, extracted } = structureOnly(card, items, choices)
    expect(roster).toHaveLength(1)
    expect(extracted.characters[0]).toMatchObject({ id: roster[0]!.key, name: 'Mira Voss', role: 'npc', kind: 'person', tier: 'principal', personality: 'Dry and tired.', speech: { examples: ['Tide waits for no one.'] } })
    expect(String(extracted.characters[0]!['summary']).length).toBeLessThanOrEqual(280)
    expect(extracted.lore.length).toBeGreaterThan(0)
    expect(extracted.lore.every(entry => entry['scope'] === 'listed')).toBe(true)
    expect(extracted.prompts).toEqual([{ id: 'roleplay/style', text: 'Write in short, plain sentences.\n\nKeep $ {secrets} out of it.' }])
    expect(Object.values(classified).every(entry => entry.roles.length > 0)).toBe(true)
    expect(extracted.notes.join()).toMatch(/without a model/)
  })

  it('leaves the style out when the card gives no instructions', () => {
    const card = cardWith({ system_prompt: '', post_history_instructions: '' })
    const { extracted } = structureOnly(card, itemise(card, defaultChoices(card)), defaultChoices(card))
    expect(extracted.prompts).toEqual([])
  })

  it('keeps unlabelled example lines when the card does not mark speakers', () => {
    const card = cardWith({ mes_example: 'Tide waits for no one.\nMind the rope.' })
    const { extracted } = structureOnly(card, itemise(card, defaultChoices(card)), defaultChoices(card))
    expect(extracted.characters[0]?.['speech']).toMatchObject({ examples: ['Tide waits for no one.', 'Mind the rope.'] })
  })
})

describe('importing a card without a model', () => {
  let root: { path: string }
  beforeEach(async () => { root = { path: await mkdtemp(join(tmpdir(), 'structure-import-')) }; await mkdir(join(root.path, 'worlds'), { recursive: true }) })
  afterEach(async () => { await rm(root.path, { recursive: true, force: true }) })

  it('writes a world that is done at once, with no chat and no review', async () => {
    const worlds = new WorldCatalog(new Context(), root as unknown as RoleplayRoot)
    const store = new ImportStore(() => root.path)
    const card = cardWith()
    const made = await store.create(card)
    const done = await importWithoutModel({ store, worlds }, made.id, { ...defaultChoices(card), name: 'Plain Harbour' })
    expect(done.draft).toBe(false)
    const record = await worlds.find(done.worldId)
    expect(record?.summary.name).toBe('Plain Harbour')
    expect(await importPhase(record!.directory)).toBe('done')
    const character = JSON.parse(await readFile(join(record!.directory, 'characters', 'mira-voss', 'character.json'), 'utf8')) as { name: string }
    expect(character.name).toBe('Mira Voss')
    expect(JSON.parse(await readFile(join(record!.directory, '.import', 'provenance.json'), 'utf8')).history[0]).toMatchObject({ kind: 'import', card: { name: 'Mira Voss' } })
  })
})
