import { describe, expect, it } from 'vitest'
import type { SourceItem } from '../../../src/host/import/items.ts'
import { buildRoster, candidatesOf, classifyItems, findEntity, foldContained, isGeneratorOnly, isLeftOut, type Classified } from '../../../src/host/import/survey.ts'
import { mapLimit, norm, slug, uniqueKey } from '../../../src/host/import/run.ts'
import { readCard } from '../../../src/host/import/card.ts'
import { v3Card } from '../../support/cards.ts'
import { fakeContext } from '../../support/jobs.ts'

const card = readCard(Buffer.from(JSON.stringify(v3Card())), 'x.json')
const item = (id: string, text: string, title = ''): SourceItem => ({ id, label: id, title, keys: [], text })

describe('names and keys', () => {
  it('compare names by their letters and digits, and make keys that are safe in a file name and unique', () => {
    expect(norm('Old  Tam!')).toBe(norm('old-tam'))
    expect(slug('Old Tam’s Light', 'x')).toBe('old-tam-s-light')
    expect(slug('港口灯塔', 'x')).toBe('港口灯塔')
    expect(slug('!!!', 'fallback')).toBe('fallback')
    const taken = new Set<string>()
    expect([uniqueKey('tam', taken), uniqueKey('tam', taken), uniqueKey('tam', taken)]).toEqual(['tam', 'tam-2', 'tam-3'])
  })

  it('runs work at most the limit at a time and keeps the order of the results', async () => {
    let running = 0
    let most = 0
    const results = await mapLimit([30, 5, 20, 1, 10], 2, async (delay, index) => { running += 1; most = Math.max(most, running); await new Promise(resolve => setTimeout(resolve, delay)); running -= 1; return index })
    expect(results).toEqual([0, 1, 2, 3, 4])
    expect(most).toBe(2)
  })
})

describe('classifying the pieces of a card', () => {
  const items = [item('entry:0', 'Tam keeps the light.', 'Tam'), item('entry:1', 'Write in the second person.', 'Style'), item('entry:2', 'Broken.', 'Broken')]

  it('asks about each piece with the card and the piece named, and keeps the answers by piece', async () => {
    const ctx = fakeContext(job => (job.prompt.includes('Style') ? { roles: ['instruction'], targets: [] } : { roles: ['character', 'speech'], targets: [{ name: ' Tam ', kind: 'character' }, { name: 'Tam', kind: 'character' }] }))
    const { classified, failures } = await classifyItems(ctx, card, items.slice(0, 2))
    expect(classified).toEqual({ 'entry:0': { roles: ['character', 'speech'], targets: [{ name: 'Tam', kind: 'character' }] }, 'entry:1': { roles: ['instruction'], targets: [] } })
    expect(failures).toEqual([])
    expect(ctx.asked[0]!.prompt).toBe('Card: Test Harbour\nPiece: entry:0\nTitle: Tam\n---\nTam keeps the light.')
    expect(new Set(ctx.asked.map(asked => asked.persona)).size).toBe(1)
    expect(isLeftOut(classified['entry:1']!)).toBe(true)
    expect(isLeftOut(classified['entry:0']!)).toBe(false)
  })

  it('refuses answers that cannot be used, and keeps a piece it could not classify as background instead of losing it', async () => {
    const ctx = fakeContext(job => (job.prompt.includes('Broken') ? { roles: [], targets: [] } : { roles: ['world'], targets: [{ name: '{{user}}', kind: 'character' }] }))
    const { classified, failures } = await classifyItems(ctx, card, items.slice(1))
    expect(classified['entry:1']).toEqual({ roles: ['world'], targets: [] })
    expect(failures).toHaveLength(1)
    expect(failures[0]).toMatch(/refused: give one to three different roles/)
  })

  it('takes a name that holds the player\'s marker as that name with the player\'s word instead of refusing the answer, and shows every piece the outline of the card', async () => {
    const ctx = fakeContext(() => ({ roles: ['faction'], targets: [{ name: 'Cult of {{user}}', kind: 'faction' }, { name: '{{user}}', kind: 'character' }] }))
    const { classified, failures } = await classifyItems(ctx, card, items.slice(0, 3))
    expect(failures).toEqual([])
    expect(classified['entry:0']!.targets).toEqual([{ name: 'Cult of the player', kind: 'faction' }])
    expect(ctx.asked[0]!.persona).toContain('All the pieces of this card, in order:')
    expect(ctx.asked[0]!.persona).toContain(`- ${items[1]!.title || items[1]!.label}`)
    expect(new Set(ctx.asked.map(asked => asked.persona)).size).toBe(1)
  })
})

describe('names that are part of longer names', () => {
  const candidate = (kind: 'character' | 'place', name: string, pieces: string[], player = false) => ({ kind, name, player, pieces, titles: [], primary: true })

  it('are folded into the one longer name that holds them, as aliases, with their pieces; a name in two longer ones stays, and so does one of another kind', () => {
    const folded = foldContained([candidate('character', 'Tam', ['a']), candidate('character', 'Old Tam', ['b']), candidate('character', 'Tamsin Vale', ['c']), candidate('character', 'Vale', ['d', 'e'], true), candidate('place', 'Tam', ['f'])])
    expect(folded.map(entry => [entry.candidate.name, entry.aliases, entry.candidate.pieces, entry.candidate.player])).toEqual([
      ['Tam', [], ['a'], false], ['Old Tam', [], ['b'], false], ['Tamsin Vale', ['Vale'], ['c', 'd', 'e'], true], ['Tam', [], ['f'], false],
    ])
  })
})

describe('the roster', () => {
  const classified: Classified = {
    'entry:0': { roles: ['character'], targets: [{ name: 'Old Tam', kind: 'character' }, { name: 'The Lighthouse', kind: 'place' }, { name: 'The Wreck', kind: 'other' }] },
    'entry:1': { roles: ['speech'], targets: [{ name: 'old tam', kind: 'character' }] },
    'entry:2': { roles: ['place'], targets: [{ name: 'The Lighthouse', kind: 'place' }] },
    'entry:3': { roles: ['player', 'world'], targets: [{ name: 'Visitor', kind: 'character' }] },
    'entry:4': { roles: ['instruction'], targets: [{ name: 'Narrator', kind: 'character' }] },
  }
  const items = ['entry:0', 'entry:1', 'entry:2', 'entry:3', 'entry:4'].map(id => item(id, id, id === 'entry:0' ? 'Tam' : ''))

  it('lists the names the pieces are about, by the kind each is named as, one for a name however it is spelled, and not events or what instructions name', () => {
    const found = candidatesOf(items, classified)
    expect(found.map(candidate => [candidate.kind, candidate.name, candidate.pieces, candidate.player])).toEqual([
      ['character', 'Old Tam', ['entry:0', 'entry:1'], false], ['place', 'The Lighthouse', ['entry:0', 'entry:2'], false], ['character', 'Visitor', ['entry:3'], true],
    ])
  })

  it('takes no names from a piece that is only guidance on making people up, and keeps its pieces from being left out', () => {
    const generator = { roles: ['generator' as const], targets: [{ name: 'The Hitchhiker', kind: 'character' as const }] }
    expect(isGeneratorOnly(generator)).toBe(true)
    expect(isGeneratorOnly({ roles: ['generator', 'instruction'], targets: [] })).toBe(true)
    expect(isGeneratorOnly({ roles: ['faction', 'generator'], targets: [] })).toBe(false)
    expect(isLeftOut(generator)).toBe(false)
    expect(candidatesOf([item('entry:0', 'Templates')], { 'entry:0': generator })).toEqual([])
    expect(candidatesOf([item('entry:0', 'The cult and its templates')], { 'entry:0': { roles: ['faction', 'generator'], targets: [{ name: 'The Cult', kind: 'faction' }] } }).map(candidate => candidate.name)).toEqual(['The Cult'])
  })

  it('leaves out a name that only turns up once inside a piece about something else, and keeps one that a piece is about, one a place\'s own piece names, the player and one mentioned in two pieces', () => {
    const classified: Classified = {
      'entry:0': { roles: ['character'], targets: [{ name: 'Old Tam', kind: 'character' }, { name: 'Passing Pat', kind: 'character' }, { name: 'The Cellar', kind: 'place' }] },
      'entry:1': { roles: ['place'], targets: [{ name: 'The Lighthouse', kind: 'place' }, { name: 'Keeper Kay', kind: 'character' }] },
      'entry:2': { roles: ['world'], targets: [{ name: 'The Guild', kind: 'faction' }, { name: 'Keeper Kay', kind: 'character' }] },
    }
    const found = candidatesOf(['entry:0', 'entry:1', 'entry:2'].map(id => item(id, id)), classified)
    expect(found.map(candidate => candidate.name)).toEqual(['Old Tam', 'The Lighthouse', 'Keeper Kay', 'The Guild'])
  })

  it('is what the merging call answers, keyed for the files, with aliases that repeat the name left out, and the player marked', async () => {
    const ctx = fakeContext(() => ({
      characters: [{ name: 'Old Tam', aliases: ['Tam', 'old tam'] }, { name: 'Visitor', aliases: [], player: true }],
      places: [{ name: 'The Lighthouse', aliases: [] }, { name: 'The Cellar', aliases: [], parent: 'The Lighthouse' }], factions: [], things: [],
    }))
    const { roster, failure } = await buildRoster(ctx, card, items, classified)
    expect(failure).toBeUndefined()
    expect(roster).toEqual([
      { kind: 'character', key: 'old-tam', name: 'Old Tam', aliases: ['Tam'], player: false },
      { kind: 'character', key: 'visitor', name: 'Visitor', aliases: [], player: true },
      { kind: 'place', key: 'the-lighthouse', name: 'The Lighthouse', aliases: [], player: false },
      { kind: 'place', key: 'the-cellar', name: 'The Cellar', aliases: [], player: false, parent: 'The Lighthouse' },
    ])
    expect(ctx.asked[0]!.prompt).toContain('character: Old Tam (2 pieces; titles: Tam)')
    expect(ctx.asked[0]!.prompt).toContain('the player\'s character')
  })

  it('refuses a merge that lists a name twice or two players, and falls back to the names as found, saying so', async () => {
    const ctx = fakeContext(() => ({ characters: [{ name: 'Tam', aliases: [] }, { name: 'tam', aliases: [] }], places: [], factions: [], things: [] }))
    const { roster, failure } = await buildRoster(ctx, card, items, classified)
    expect(failure).toMatch(/could not be merged: refused: characters: "tam" is listed twice/)
    expect(roster.map(entity => [entity.kind, entity.name])).toEqual([['character', 'Old Tam'], ['character', 'Visitor'], ['place', 'The Lighthouse']])
    expect(roster.find(entity => entity.name === 'Visitor')?.player).toBe(true)
  })

  it('asks nothing when there are no names', async () => {
    const ctx = fakeContext(() => { throw new Error('should not be asked') })
    expect(await buildRoster(ctx, card, [], {})).toEqual({ roster: [] })
  })

  it('finds an entity by its name or an alias, or by a name it contains or is contained in when only one fits', () => {
    const roster = [
      { kind: 'character' as const, key: 'old-tam', name: 'Old Tam', aliases: ['Tam'], player: false },
      { kind: 'character' as const, key: 'tamsin', name: 'Tamsin Vale', aliases: [], player: false },
      { kind: 'place' as const, key: 'light', name: 'The Lighthouse', aliases: [], player: false },
    ]
    expect(findEntity(roster, 'old  tam')?.key).toBe('old-tam')
    expect(findEntity(roster, 'Tam')?.key).toBe('old-tam')
    expect(findEntity(roster, 'Vale')?.key).toBe('tamsin')
    expect(findEntity(roster, 'Lighthouse', 'place')?.key).toBe('light')
    expect(findEntity(roster, 'Lighthouse', 'character')).toBeUndefined()
    expect(findEntity(roster, 'Ta')).toBeUndefined()
    expect(findEntity(roster, '')).toBeUndefined()
  })
})

describe('pieces a decision model settles', () => {
  const items = [item('entry:0', 'Tam keeps the light.', 'Tam'), item('entry:1', 'Write in the second person.', 'Style'), item('entry:2', 'Made by someone, v2.', 'Credits'), item('entry:3', 'Maybe a rule, maybe a place.', 'Odd')]
  const probabilities: Record<string, [number, number]> = { Tam: [0.02, 0.01], Style: [0.97, 0.02], Credits: [0.1, 0.96], Odd: [0.6, 0.4] }
  const decided = (state: Record<string, unknown>) => new Map<string, number>([['instruction', probabilities[String(state['title'])]![0]], ['irrelevant', probabilities[String(state['title'])]![1]]])

  it('are not put to the language model when the decision model is sure they are only instructions or notes, and the rest are', async () => {
    const ctx = fakeContext(() => ({ roles: ['character'], targets: [{ name: 'Tam', kind: 'character' }] }))
    const asked: string[] = []
    ctx.decide = (state, questions) => { asked.push(...questions.map(question => question.instructions)); return Promise.resolve(decided(state)) }
    ctx.confidence = 0.7
    const { classified, failures, decided: settled } = await classifyItems(ctx, card, items)
    expect(classified['entry:1']).toEqual({ roles: ['instruction'], targets: [] })
    expect(classified['entry:2']).toEqual({ roles: ['irrelevant'], targets: [] })
    expect(classified['entry:0']!.roles).toEqual(['character'])
    expect(classified['entry:3']!.roles).toEqual(['character'])
    expect(settled).toBe(2)
    expect(failures).toEqual([])
    expect(ctx.asked.map(job => job.prompt.split('\n')[2])).toEqual(['Title: Tam', 'Title: Odd'])
    expect(asked.every(text => text.length > 50)).toBe(true)
  })

  it('go to the language model when the decision model cannot be used, and the problem is reported', async () => {
    const ctx = fakeContext(() => ({ roles: ['world'], targets: [] }))
    ctx.decide = () => Promise.reject(new Error('no decision service is selected'))
    const { classified, failures, decided: settled } = await classifyItems(ctx, card, items)
    expect(settled).toBe(0)
    expect(ctx.asked).toHaveLength(4)
    expect(Object.values(classified).every(entry => entry.roles[0] === 'world')).toBe(true)
    expect(failures).toEqual(['the decision model could not be used, the language model sorted those pieces: no decision service is selected'])
  })

  it('ask nothing of a decision model that is not in use', async () => {
    const ctx = fakeContext(() => ({ roles: ['world'], targets: [] }))
    expect((await classifyItems(ctx, card, items)).decided).toBe(0)
    expect(ctx.asked).toHaveLength(4)
  })
})

describe('the labels of what a job is shown', () => {
  it('follow the language of the import', async () => {
    const ctx = fakeContext(() => ({ roles: ['world'], targets: [] }))
    ctx.language = 'zh-CN'
    await classifyItems(ctx, card, [item('entry:0', 'Tam keeps the light.', 'Tam')])
    expect(ctx.asked[0]!.prompt).toBe('卡片：Test Harbour\n片段：entry:0\n标题：Tam\n---\nTam keeps the light.')
  })
})
