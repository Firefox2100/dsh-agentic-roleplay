import { describe, expect, it } from 'vitest'
import { readCard } from '../../../src/host/import/card.ts'
import { characterDocument, documentProblem, extractEntities, factionDocument, loreDocuments, placeDocument, sourcesFor, thingDocument, variableDocuments, variablesProblem } from '../../../src/host/import/extract.ts'
import type { SourceItem } from '../../../src/host/import/items.ts'
import type { Classified, Roster } from '../../../src/host/import/survey.ts'
import { v3Card } from '../../support/cards.ts'
import { fakeContext } from '../../support/jobs.ts'

const card = readCard(Buffer.from(JSON.stringify(v3Card())), 'x.json')
const entity = (kind: 'character' | 'place' | 'faction' | 'thing', key: string, name: string, extra: { aliases?: string[]; player?: boolean; parent?: string } = {}) => ({ kind, key, name, aliases: extra.aliases ?? [], player: extra.player ?? false, ...(extra.parent === undefined ? {} : { parent: extra.parent }) })
const roster: Roster = [
  entity('character', 'tam', 'Old Tam', { aliases: ['Tam'] }), entity('character', 'mira', 'Mira Voss'), entity('character', 'visitor', 'Visitor', { player: true }),
  entity('place', 'light', 'The Lighthouse'), entity('place', 'cellar', 'The Cellar', { parent: 'The Lighthouse' }), entity('faction', 'guild', 'Net Guild'), entity('thing', 'ledger', 'The Ledger'),
]
const item = (id: string, text: string, title = ''): SourceItem => ({ id, label: id, title, keys: [], text })

describe('what an entity is made from', () => {
  const items = [
    item('entry:0', 'Tam keeps the light and writes the ledger.', 'Tam'), item('entry:1', '"Fog again," says Tam.', 'Tam lines'), item('entry:2', 'Mira once met Old Tam at the pier.', 'Mira'),
    item('entry:3', 'Write short answers.', 'Style'), item('entry:4', 'The harbour has a long history.', 'History'),
  ]
  const classified: Classified = {
    'entry:0': { roles: ['character'], targets: [{ name: 'Old Tam', kind: 'character' }] }, 'entry:1': { roles: ['speech'], targets: [{ name: 'tam', kind: 'character' }] }, 'entry:2': { roles: ['character'], targets: [{ name: 'Mira Voss', kind: 'character' }] },
    'entry:3': { roles: ['instruction'], targets: [{ name: 'Old Tam', kind: 'character' }] }, 'entry:4': { roles: ['world'], targets: [] },
  }

  it('is the pieces about it, then others that name it, and never the instructions', () => {
    expect(sourcesFor(roster[0]!, items, classified).map(source => source.id)).toEqual(['entry:0', 'entry:1', 'entry:2'])
    expect(sourcesFor(roster[1]!, items, classified).map(source => source.id)).toEqual(['entry:2'])
    expect(sourcesFor(roster[3]!, items, classified)).toEqual([])
  })

  it('stays within a budget of text, keeping the pieces about the entity first', () => {
    const big = Array.from({ length: 5 }, (_, index) => item(`entry:${index}`, `Tam ${'x'.repeat(4000)}`))
    const tagged: Classified = Object.fromEntries(big.map(piece => [piece.id, { roles: ['character' as const], targets: [{ name: 'Old Tam', kind: 'character' as const }] }]))
    const chosen = sourcesFor(roster[0]!, big, tagged)
    expect(chosen.length).toBeGreaterThan(0)
    expect(chosen.reduce((sum, source) => sum + source.text.length, 0)).toBeLessThanOrEqual(14_000 + 4_100)
  })
})

describe('the documents of the world', () => {
  it('makes a character file with places, relations and goals resolved to keys, and notes what names nobody', () => {
    const { document, notes } = characterDocument(roster[0]!, {
      aliases: ['Tam', 'Keeper'], age: '60', tier: 'supporting', kind: 'person', summary: 'Keeps the light.', personality: 'Gruff.', background: '', appearance: 'Weathered.', speech: { style: 'Terse', examples: ['Fog again.'] },
      start: { public_state: 'Trimming the lamp', location: 'lighthouse', position: 'by the lamp' }, goals: [{ name: 'Find the ledger', description: 'It went missing' }],
      relationships: [{ with: 'mira', label: 'ward' }, { with: 'Nobody At All', label: 'friend' }, { with: 'Old Tam', label: 'self' }, { with: 'Mira Voss', label: 'again' }],
    }, roster)
    expect(document).toEqual({
      id: 'tam', name: 'Old Tam', aliases: ['Tam', 'Keeper'], age: '60', role: 'npc', kind: 'person', tier: 'supporting', summary: 'Keeps the light.', personality: 'Gruff.', background: '', appearance: 'Weathered.',
      speech: { style: 'Terse', examples: ['Fog again.'] }, start: { public_state: 'Trimming the lamp', location: 'light', position: 'by the lamp', intents: [{ type: 'agenda', name: 'Find the ledger', description: 'It went missing', status: 'active' }] },
      relationships: [{ to: 'mira', label: 'ward' }],
    })
    expect(notes).toEqual(['Old Tam: the relationship with "Nobody At All" names nobody in the world'])
    expect(documentProblem('character', document)).toBeUndefined()
  })

  it('makes the character the player plays playable: a person, and not a background character', () => {
    const { document } = characterDocument(roster[2]!, { tier: 'background', kind: 'group', summary: 's', personality: '', background: '', appearance: '', speech: { style: '', examples: [] } }, roster)
    expect(document).toMatchObject({ role: 'playable', kind: 'person', tier: 'principal' })
    expect(documentProblem('character', document)).toBeUndefined()
    expect(characterDocument(roster[1]!, { tier: 'nonsense', kind: 'group', summary: 's', personality: '', background: '', appearance: '', speech: { style: '', examples: [] } }, roster).document).toMatchObject({ role: 'npc', kind: 'group', tier: 'supporting' })
  })

  it('makes a place with its parent, features and ways to other places, and drops ways that lead nowhere', () => {
    const { document, notes } = placeDocument(roster[4]!, {
      description: 'Damp.', parent: 'The Lighthouse', features: [{ name: 'Barrel', description: 'Oak' }, { name: ' ' }],
      exits: [{ to: 'The Lighthouse', description: 'a stair' }, { to: 'The Moon' }, { to: 'The Cellar' }, { to: 'the lighthouse' }],
    }, roster)
    expect(document).toEqual({ id: 'cellar', name: 'The Cellar', description: 'Damp.', parent: 'light', features: [{ id: 'feature-1', name: 'Barrel', description: 'Oak' }], exits: [{ to: 'light', description: 'a stair' }] })
    expect(notes).toEqual(['The Cellar: the way to "The Moon" leads to no place of the world', 'The Cellar: the way to "The Cellar" leads to no place of the world'])
    expect(documentProblem('location', document)).toBeUndefined()
  })

  it('takes the place a place is in from the roster when the call names none', () => {
    expect(placeDocument(roster[4]!, { description: 'Damp.' }, roster).document['parent']).toBe('light')
  })

  it('makes a faction whose members are characters of the world', () => {
    const { document, notes } = factionDocument(roster[5]!, { summary: 'Fishers.', description: 'They share nets.', values: ['Share the catch'], public_state: 'Quiet', members: [{ character: 'Mira', role: 'master' }, { character: 'Ghost' }] }, roster)
    expect(document).toEqual({ id: 'guild', name: 'Net Guild', summary: 'Fishers.', description: 'They share nets.', values: ['Share the catch'], start: { public_state: 'Quiet' }, members: [{ character: 'mira', role: 'master' }] })
    expect(notes).toEqual(['Net Guild: the member "Ghost" is nobody in the world'])
    expect(documentProblem('faction', document)).toBeUndefined()
  })

  it('makes a thing that starts in a place or in someone\'s hands, and says when it is nowhere', () => {
    expect(thingDocument(roster[6]!, { description: 'A ledger.', held_by: 'Tam', location: 'The Cellar' }, roster).document).toEqual({ id: 'ledger', name: 'The Ledger', unique: true, description: 'A ledger.', held_by: 'tam' })
    const placed = thingDocument(roster[6]!, { description: 'A ledger.', location: 'the cellar', notable: true }, roster)
    expect(placed.document).toMatchObject({ location: 'cellar', notable: true })
    expect(documentProblem('item', placed.document)).toBeUndefined()
    expect(thingDocument(roster[6]!, { description: 'A ledger.' }, roster).notes).toEqual(['The Ledger: it is nowhere in the world and nobody has it, so it is left out'])
  })

  it('makes lore entries with unique ids and subjects that exist, and nothing from an entry with no body', () => {
    const taken = new Set<string>()
    const built = loreDocuments({ entries: [
      { title: 'The Founding', kind: 'history', summary: 's', body: 'Long ago.', subjects: [{ kind: 'place', name: 'The Lighthouse' }, { kind: 'character', name: 'Nobody' }, { kind: 'faction', name: 'Net Guild' }] },
      { title: 'The Founding', kind: 'nonsense', summary: '', body: 'Again.' }, { title: 'Empty', kind: 'history', summary: '', body: ' ' },
    ] }, roster, taken)
    expect(built.map(entry => entry.document)).toEqual([
      { id: 'the-founding', title: 'The Founding', kind: 'history', summary: 's', body: 'Long ago.', subjects: [{ kind: 'location', id: 'light' }, { kind: 'faction', id: 'guild' }] },
      { id: 'the-founding-2', title: 'The Founding', kind: 'other', summary: '', body: 'Again.' },
    ])
    expect(built[0]!.notes).toEqual(['The Founding: the subject "Nobody" is not in the world'])
    expect(documentProblem('lore', built[0]!.document)).toBeUndefined()
  })
})

describe('extracting a whole roster', () => {
  const items = [item('entry:0', 'Tam keeps the light.', 'Tam'), item('entry:1', 'Long ago the harbour was founded.', 'History')]
  const classified: Classified = { 'entry:0': { roles: ['character'], targets: [{ name: 'Old Tam', kind: 'character' }] }, 'entry:1': { roles: ['world'], targets: [] } }
  const answers = (job: { prompt: string }): unknown => {
    if (job.prompt.includes('Make the character: Mira Voss')) throw new Error('the model never answered')
    if (job.prompt.includes('Make the character')) return { tier: 'principal', kind: 'person', summary: 'Keeps the light.', personality: '', background: '', appearance: '', speech: { style: '', examples: [] } }
    if (job.prompt.includes('Make the place')) return { description: 'A tower.' }
    if (job.prompt.includes('Make the faction')) return { summary: 'Fishers.', description: 'Nets.' }
    if (job.prompt.includes('Make the thing')) return { description: 'A ledger.' }
    return { entries: [{ title: 'Founding', kind: 'history', summary: 's', body: 'The harbour was founded.', subjects: [{ kind: 'place', name: 'The Lighthouse' }] }] }
  }

  it('writes each entity from its own pieces, and the background pieces as lore; what failed is noted, not lost silently', async () => {
    const ctx = fakeContext(answers)
    const made = await extractEntities(ctx, card, items, classified, roster)
    expect(made.characters.map(document => document['id'])).toEqual(['tam', 'visitor'])
    expect(made.locations.map(document => document['id'])).toEqual(['light', 'cellar'])
    expect(made.factions.map(document => document['id'])).toEqual(['guild'])
    expect(made.items).toEqual([])
    expect(made.lore).toEqual([{ id: 'founding', title: 'Founding', kind: 'history', summary: 's', body: 'The harbour was founded.', subjects: [{ kind: 'location', id: 'light' }] }])
    expect(made.notes).toEqual(expect.arrayContaining(['character Mira Voss: the model never answered', 'The Ledger: it is nowhere in the world and nobody has it, so it is left out']))
    const tamJob = ctx.asked.find(asked => asked.prompt.includes('Make the character: Old Tam'))!
    expect(tamJob.prompt).toContain('[entry:0] Tam\nTam keeps the light.')
    expect(tamJob.prompt).toContain('characters: Old Tam; Mira Voss; Visitor')
    expect(new Set(ctx.asked.filter(asked => asked.prompt.includes('Make the character')).map(asked => asked.persona)).size).toBe(1)
  })
})

describe('the variables a card tracks', () => {
  const roster: Roster = [{ kind: 'character', key: 'mira', name: 'Mira Voss', aliases: [], player: false }]
  const answer = { variables: [
    { key: 'Trust in Mira', name: 'Trust', description: '', kind: 'number', subject: 'character', visibility: 'public', only: ['Mira Voss', 'Nobody'], min: 0, max: 100, integer: true, default: 30, options: [], bands: [{ up_to: 40, label: 'wary' }] },
    { key: '信任', name: 'Coins', description: 'The player\'s money', kind: 'number', subject: 'character', visibility: 'public', only: [], min: null, max: null, integer: false, default: null, options: [], bands: [] },
  ] }

  it('become documents: keys fitted, names turned into keys, empty and null left out', () => {
    expect(variableDocuments(answer, roster)).toEqual([
      { key: 'trust_in_mira', name: 'Trust', kind: 'number', subject: 'character', visibility: 'public', only: ['mira'], min: 0, max: 100, integer: true, default: 30, bands: [{ up_to: 40, label: 'wary' }] },
      { key: 'variable_2', name: 'Coins', description: 'The player\'s money', kind: 'number', subject: 'character', visibility: 'public', integer: false },
    ])
  })

  it('are refused with the reason when the world could not take them', () => {
    expect(variablesProblem(variableDocuments(answer, roster), roster)).toBeUndefined()
    expect(variablesProblem([{ key: 'a', name: 'A', kind: 'number', subject: 'character', min: 10, max: 1 }], roster)).toMatch(/bounds/)
  })
})
