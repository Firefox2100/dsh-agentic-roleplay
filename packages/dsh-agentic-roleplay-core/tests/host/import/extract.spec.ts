import { describe, expect, it } from 'vitest'
import { readCard } from '../../../src/host/import/card.ts'
import { characterDocument, completeAwareness, documentProblem, extractEntities, pruneKnowledge, factionDocument, loreDocuments, extractVariables, passageProblem, trackingGroups, placeDocument, pruneLinks, pruneMembers, sourcesFor, thingDocument, variableDocuments, variablesProblem } from '../../../src/host/import/extract.ts'
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

  it('makes what a character knows of places and things into keys, and notes what is not in the world', () => {
    const { document, notes } = characterDocument(roster[0]!, { tier: 'supporting', kind: 'person', summary: 's', personality: '', background: '', appearance: '', speech: { style: '', examples: [] }, knows: { places: ['The Cellar', 'cellar', 'Nowhere'], things: ['the ledger'] } }, roster)
    expect(document['knowledge']).toEqual({ locations: ['cellar'], items: ['ledger'] })
    expect(notes).toEqual(['Old Tam: "Nowhere" is not one of the world\'s places, so they do not know of it'])
    expect(documentProblem('character', document)).toBeUndefined()
  })

  it('makes the ways a character knows into pairs of places, and keeps only ways the world has', () => {
    const { document, notes } = characterDocument(roster[0]!, { tier: 'supporting', kind: 'person', summary: 's', personality: '', background: '', appearance: '', speech: { style: '', examples: [] }, knows: { ways: [{ from: 'The Cellar', to: 'The Light' }, { from: 'cellar', to: 'light' }, { from: 'Nowhere', to: 'light' }] } }, roster)
    const exits = (document['knowledge'] as { exits: { from: string; to: string }[] }).exits
    expect(exits).toHaveLength(1)
    expect(notes).toHaveLength(1)
    const result = { characters: [{ id: 'tam', name: 'Tam', knowledge: { exits: [exits[0]!, { from: 'light', to: 'cellar' }] } }], locations: [{ id: 'cellar', exits: [{ to: 'light' }] }, { id: 'light' }], items: [], notes: [] as string[] }
    pruneKnowledge(result)
    expect(result.characters[0]!['knowledge']).toEqual({ exits: [exits[0]] })
    expect(result.notes).toHaveLength(1)
  })

  it('takes out of what characters know the places and things that were not written', () => {
    const result = { characters: [{ id: 'tam', name: 'Old Tam', knowledge: { locations: ['cellar', 'gone'], items: ['ledger'] } }, { id: 'mira', name: 'Mira', knowledge: { items: ['ledger'] } }], locations: [{ id: 'cellar' }], items: [], notes: [] as string[] }
    pruneKnowledge(result)
    expect(result.characters.map(character => character['knowledge'])).toEqual([{ locations: ['cellar'] }, undefined])
    expect(result.notes).toHaveLength(3)
  })

  it('makes the people a character names know of the character, and a character know the lore that is about them', () => {
    const result = {
      characters: [{ id: 'tam', name: 'Tam', relationships: [{ to: 'mira', label: 'ward' }, { to: 'gone', label: 'x' }] }, { id: 'mira', name: 'Mira' }, { id: 'visitor', name: 'Visitor', relationships: [{ to: 'tam', label: 'host' }] }] as Record<string, unknown>[],
      lore: [{ id: 'the-wreck', subjects: [{ kind: 'character', id: 'tam' }, { kind: 'location', id: 'cellar' }] }, { id: 'tides', subjects: [] }] as Record<string, unknown>[],
      notes: [] as string[],
    }
    completeAwareness(result)
    expect(result.characters[1]!['relationships']).toEqual([{ to: 'tam', label: 'acquaintance' }])
    expect(result.characters[0]!['relationships']).toEqual([{ to: 'mira', label: 'ward' }, { to: 'gone', label: 'x' }, { to: 'visitor', label: 'acquaintance' }])
    expect(result.characters[0]!['knowledge']).toEqual({ lore: ['the-wreck'] })
    expect(result.characters[1]!['knowledge']).toBeUndefined()
    expect(result.notes).toHaveLength(1)
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

describe('guidance on making people up while the story is played', () => {
  const pieces = [item('entry:0', 'Template 1: a hitchhiker at a gas station. Template 2: a rich stranger. Every new person gets a name, an age, a job and six lines of speech.', 'Who turns up'), item('entry:1', 'The harbour is old. Visitors arrive by boat. Tam keeps the light.', 'Harbour')]
  const classified: Classified = {
    'entry:0': { roles: ['generator'], targets: [{ name: 'Hitchhiker', kind: 'character' }] }, 'entry:1': { roles: ['world', 'generator'], targets: [{ name: 'Old Tam', kind: 'character' }] },
  }

  it('is kept in the card\'s words as lore only the game master and the author read, not rewritten and not made into entities', async () => {
    const ctx = fakeContext(() => { throw new Error('no job may run') })
    const made = await extractEntities(ctx, card, pieces, classified, [])
    expect(ctx.asked).toEqual([])
    expect(made.lore.map(entry => [entry['title'], entry['kind'], entry['scope'], entry['body']])).toEqual([
      ['Who turns up', 'custom', 'listed', pieces[0]!.text], ['Harbour', 'custom', 'listed', pieces[1]!.text],
    ])
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

describe('finding the guidance inside a piece', () => {
  const source = 'The harbour is old and its stones are grey with salt and gulls. Boats come in at dawn and leave at dusk.\n\nWhen a new visitor arrives, write   their profile:\nname, age, job.\n\nTam keeps the light.'
  const piece = item('entry:0', source, 'Harbour')
  const classified: Classified = { 'entry:0': { roles: ['world', 'instruction'], targets: [] }, 'entry:1': { roles: ['speech'], targets: [] } }

  it('accepts passages that are in the piece word for word, whatever its spacing, and refuses the rest', () => {
    expect(passageProblem({ casting: ['When a new visitor arrives, write their profile: name, age, job.'], rules: [] }, source)).toBeUndefined()
    expect(passageProblem({ casting: [], rules: [] }, source)).toBeUndefined()
    expect(passageProblem({ casting: ['A newcomer gets a profile.'], rules: [] }, source)).toMatch(/passage 1 is not in the piece word for word/)
    expect(passageProblem({ casting: [], rules: Array.from({ length: 40 }, () => 'Tam keeps the light.') }, source)).toBeUndefined()
  })

  it('makes lore of the passages a piece holds, the game master\'s and the author\'s only', async () => {
    const ctx = fakeContext(() => ({ casting: ['When a new visitor arrives, write their profile: name, age, job.'], rules: [] }))
    const long = item('entry:1', 'Short.', 'Short')
    const made = await extractEntities(ctx, card, [piece, long], classified, [])
    expect(ctx.asked).toHaveLength(1)
    expect(made.lore).toHaveLength(1)
    expect(made.lore[0]).toMatchObject({ title: 'Harbour: how people are made up', kind: 'custom', scope: 'listed', body: 'When a new visitor arrives, write their profile: name, age, job.' })
  })

  it('adds nothing when the piece holds none, and notes a piece that could not be searched', async () => {
    const none = await extractEntities(fakeContext(() => ({ casting: [], rules: [] })), card, [piece], classified, [])
    expect(none.lore).toEqual([])
    const broken = await extractEntities(fakeContext(() => { throw new Error('no answer') }), card, [piece], classified, [])
    expect(broken.lore).toEqual([])
    expect(broken.notes.some(note => note.includes('no answer'))).toBe(true)
  })
})

describe('the members of a faction', () => {
  it('are only characters that were written: a member whose character is missing is left out with a note, and a faction with no member keeps none', () => {
    const result = { characters: [{ id: 'tam' }], factions: [{ id: 'guild', name: 'Net Guild', members: [{ character: 'tam' }, { character: 'ghost' }] }, { id: 'pack', name: 'The Pack', members: [{ character: 'ghost' }] }, { id: 'all', name: 'All', members: [{ character: 'tam' }] }], notes: [] as string[] }
    pruneMembers(result)
    expect(result.factions.map(faction => faction['members'])).toEqual([[{ character: 'tam' }], undefined, [{ character: 'tam' }]])
    expect(result.notes).toEqual(['Net Guild: 1 member(s) left out because the world has no such character', 'The Pack: 1 member(s) left out because the world has no such character'])
  })
})

describe('the links between places and from a character to a place', () => {
  it('are only links to what was written: a parent, a way or a starting place that is missing is taken out with a note, and the document stays', () => {
    const result = {
      characters: [{ id: 'tam', name: 'Old Tam', start: { location: 'nowhere', position: 'by the door' } }, { id: 'mira', name: 'Mira', start: { location: 'light', position: 'on the stairs' } }],
      locations: [{ id: 'light', name: 'The Lighthouse', parent: 'island', exits: [{ to: 'cellar' }, { to: 'sea' }] }, { id: 'cellar', name: 'The Cellar', parent: 'light' }],
      notes: [] as string[],
    }
    pruneLinks(result)
    expect(result.locations).toEqual([{ id: 'light', name: 'The Lighthouse', exits: [{ to: 'cellar' }] }, { id: 'cellar', name: 'The Cellar', parent: 'light' }])
    expect(result.characters).toEqual([{ id: 'tam', name: 'Old Tam' }, { id: 'mira', name: 'Mira', start: { location: 'light', position: 'on the stairs' } }])
    expect(result.notes).toEqual([
      'The Lighthouse: its parent place is left out because the world has no such place',
      'The Lighthouse: 1 way(s) left out because they lead to a place the world does not have',
      'Old Tam: its starting place is left out because the world has no such place',
    ])
  })
})

describe('a card that keeps its game state in variables', () => {
  it('has its state specification read for what it tracks whatever role the piece was given, and a piece of no such kind is not', async () => {
    const spec = item('entry:0', 'Variable rules: stat_data holds the player\'s health, from 0 to 100; update it with JSON Patch commands.', 'State')
    const lore = item('entry:1', 'The harbour is old and its stones are grey with salt.', 'Harbour')
    const classified: Classified = { 'entry:0': { roles: ['world'], targets: [] }, 'entry:1': { roles: ['world'], targets: [] } }
    const asked = fakeContext(() => ({ variables: [], left_out: [] }))
    await extractVariables(asked, card, [spec, lore], classified, [])
    expect(asked.asked).toHaveLength(1)
    expect(asked.asked[0]!.prompt).toContain('stat_data')
    expect(asked.asked[0]!.prompt).not.toContain('harbour is old')
    const none = fakeContext(() => ({ variables: [], left_out: [] }))
    await extractVariables(none, card, [lore], classified, [])
    expect(none.asked).toHaveLength(0)
  })
})

describe('the standing rules of a card', () => {
  const rule = 'Each check is one ${d100} roll under the skill; a roll of 96 or more is a fumble and always has a cost.'
  const base = 'The harbour is old and its stones are grey with salt and gulls. Boats come in at dawn and leave at dusk, every day of the year without fail. '
  const always = { ...item('entry:0', `${base}${rule}`, 'Checks'), constant: true }
  const keyed = item('entry:1', `${base}${rule} (keyed)`, 'Keyed')
  const classified: Classified = { 'entry:0': { roles: ['world', 'instruction'], targets: [] }, 'entry:1': { roles: ['world', 'instruction'], targets: [] } }

  it('are carried on every turn when the card always sends them, as a prompt of the world with the dollar and brace markup made inert, and found by search as lore when it does not', async () => {
    const ctx = fakeContext(() => ({ casting: [], rules: [rule] }))
    const made = await extractEntities(ctx, card, [always, keyed], classified, [])
    const standing = made.prompts.find(entry => entry.id === 'roleplay/standing')
    expect(standing?.text).toBe(`## Checks\n${rule.replace('${d100}', '$ {d100}')}`)
    expect(made.lore.map(entry => [entry['title'], entry['scope']])).toEqual([['Keyed: rules and mechanics', 'listed']])
  })

  it('go to lore when they would be more than the game master carries', async () => {
    const long = `${rule} ${'x'.repeat(12_100)}`
    const ctx = fakeContext(() => ({ casting: [], rules: [long] }))
    const big = { ...item('entry:0', `${base}${long}`, 'Checks'), constant: true }
    const made = await extractEntities(ctx, card, [big], { 'entry:0': classified['entry:0']! }, [])
    expect(made.prompts.some(entry => entry.id === 'roleplay/standing')).toBe(false)
    expect(made.lore).toHaveLength(1)
  })
})

describe('the tracking text of a card, read in groups', () => {
  it('is cut into groups that each fit one request, keeping the order and cutting a piece that is longer than one', () => {
    expect(trackingGroups(['a'.repeat(40), 'b'.repeat(40), 'c'.repeat(40), 'd'.repeat(300)], 100).map(group => group.map(text => text.length))).toEqual([[40, 40], [40], [100]])
    expect(trackingGroups([])).toEqual([])
  })

  it('has each group asked for, the first declaration of a key kept, and a group that fails only noted', async () => {
    const big = (id: string, key: string) => item(id, `The state is kept in stat_data. ${'x'.repeat(5000)} ${key}`, 'State')
    const classified: Classified = { 'entry:0': { roles: ['world'], targets: [] }, 'entry:1': { roles: ['world'], targets: [] }, 'entry:2': { roles: ['world'], targets: [] } }
    let call = 0
    const asked = fakeContext(() => {
      call += 1
      if (call === 3) throw new Error('stopped')
      return { variables: [{ key: 'health', name: call === 1 ? 'First' : 'Second', description: 'd', kind: 'number', subject: 'world', visibility: 'public', only: [], min: 0, max: 10, integer: true, default: 5, options: [], bands: [] }], left_out: [] }
    })
    const made = await extractVariables(asked, card, [big('entry:0', 'a'), big('entry:1', 'b'), big('entry:2', 'c')], classified, [])
    expect(asked.asked.length).toBeGreaterThanOrEqual(3)
    expect(made.variables.map(variable => variable['name'])).toEqual(['First'])
    expect(made.notes.join()).toMatch(/was not carried over/)
  })
})

describe('a card that tracks many values', () => {
  const variable = (key: string) => ({ key, name: key, description: 'd', kind: 'number', subject: 'world', visibility: 'public', only: [], min: 0, max: 10, integer: true, default: 5, options: [], bands: [] })
  const spec = { ...item('entry:0', 'The state is kept in stat_data; every meter is listed below.', 'State'), constant: false }
  const classified: Classified = { 'entry:0': { roles: ['world'], targets: [] } }

  it('is asked again for the rest while each answer fills its share, told what is declared already, and the count has no ceiling of its own', async () => {
    const answers = [['a', 'b', 'c'], ['d', 'e', 'f'], ['g']]
    const asked = fakeContext((_job, count) => ({ variables: answers[count - 1]!.map(variable), left_out: count === 1 ? ['a format'] : [] }))
    Object.assign(asked, { variablesPerRequest: 3 })
    const made = await extractVariables(asked, card, [spec], classified, [])
    expect(made.variables.map(entry => entry['key'])).toEqual(['a', 'b', 'c', 'd', 'e', 'f', 'g'])
    expect(asked.asked).toHaveLength(3)
    expect(asked.asked[0]!.persona).toContain('at most 3 variables')
    expect(asked.asked[0]!.prompt).not.toContain('Already declared')
    expect(asked.asked[1]!.prompt).toContain('Already declared (do not declare them again): a, b, c')
    expect(made.notes).toEqual(['not tracked: a format'])
  })

  it('stops when a round brings nothing new, and keeps what it has when a later round fails', async () => {
    const same = fakeContext(() => ({ variables: ['a', 'b'].map(variable), left_out: [] }))
    Object.assign(same, { variablesPerRequest: 2 })
    expect((await extractVariables(same, card, [spec], classified, [])).variables).toHaveLength(2)
    expect(same.asked).toHaveLength(2)
    const failing = fakeContext((_job, count) => { if (count === 2) throw new Error('stopped'); return { variables: ['a', 'b'].map(variable), left_out: [] } })
    Object.assign(failing, { variablesPerRequest: 2 })
    const made = await extractVariables(failing, card, [spec], classified, [])
    expect(made.variables).toHaveLength(2)
    expect(made.notes.join()).toMatch(/after round 1: stopped/)
  })
})

describe('a declaration of tracked values that cannot be used', () => {
  const ok = (key: string) => ({ key, name: key, description: 'd', kind: 'number', subject: 'world', visibility: 'public', only: [], min: 0, max: 10, integer: true, default: 5, options: [], bands: [] })
  const spec = item('entry:0', 'The state is kept in stat_data; every meter is listed below.', 'State')
  const classified: Classified = { 'entry:0': { roles: ['world'], targets: [] } }

  it('is left out with its reason while the others of the answer are kept', async () => {
    const broken = { ...ok('pick'), kind: 'choice', options: ['only one'], min: null, max: null, integer: false, default: null }
    const asked = fakeContext(() => ({ variables: [ok('a'), broken, ok('b')], left_out: [] }))
    const made = await extractVariables(asked, card, [spec], classified, [])
    expect(made.variables.map(entry => entry['key'])).toEqual(['a', 'b'])
    expect(made.notes.join()).toMatch(/not tracked: pick: .*a choice has from 2 to 12 different options/)
  })
})
