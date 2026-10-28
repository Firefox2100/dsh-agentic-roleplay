import { describe, expect, it } from 'vitest'
import type { ImportChoices, NormalizedCard } from '../../../src/shared/import-card.ts'
import { cardChanges, diffText, matchPieces, worldFieldChanges } from '../../../src/host/import/card-diff.ts'
import type { CardPiece } from '../../../src/host/import/card-tools.ts'

const piece = (id: string, text: string, title = '', keys: string[] = []): CardPiece => ({ id, label: id, title, keys, text, used: true })

describe('matching the pieces of two versions of a card', () => {
  it('pairs fields by what they are and finds the added and the dropped', () => {
    const match = matchPieces(
      [piece('field:description', 'a'), piece('field:scenario', 'b'), piece('field:greeting-1', 'g')],
      [piece('field:description', 'a changed'), piece('field:greeting-1', 'g'), piece('field:greeting-2', 'new')],
    )
    expect(match.pairs.map(pair => [pair.before.id, pair.after.id])).toEqual([['field:description', 'field:description'], ['field:greeting-1', 'field:greeting-1']])
    expect(match.added.map(entry => entry.id)).toEqual(['field:greeting-2'])
    expect(match.removed.map(entry => entry.id)).toEqual(['field:scenario'])
  })

  it('follows lorebook entries that moved, by title and keys first and then by text', () => {
    const match = matchPieces(
      [piece('entry:0', 'The tide table is on the wall.', 'Tide table', ['tide']), piece('entry:1', 'Joss keeps a grey boat at the quay.', '', []), piece('entry:2', 'Dropped altogether.', 'Gone', ['gone'])],
      [piece('entry:0', 'Brand new entry.', 'Fresh', ['fresh']), piece('entry:1', 'Tides come in twice a day, the table says.', 'Tide table', ['tide']), piece('entry:2', 'Joss keeps a grey boat at the quay.', '', [])],
    )
    expect(match.pairs.map(pair => [pair.before.id, pair.after.id])).toEqual([['entry:0', 'entry:1'], ['entry:1', 'entry:2']])
    expect(match.added.map(entry => entry.id)).toEqual(['entry:0'])
    expect(match.removed.map(entry => entry.id)).toEqual(['entry:2'])
  })

  it('falls back on the same number when most of the words are shared, and not otherwise', () => {
    const near = matchPieces([piece('entry:0', 'Mara keeps the ferry and rings the bell at dawn.')], [piece('entry:0', 'Mara keeps the ferry and rings the bell at dusk.')])
    expect(near.pairs).toHaveLength(1)
    const far = matchPieces([piece('entry:0', 'Mara keeps the ferry and rings the bell at dawn.')], [piece('entry:0', 'Something else entirely about weather.')])
    expect(far.pairs).toHaveLength(0)
    expect(far.added).toHaveLength(1)
    expect(far.removed).toHaveLength(1)
  })
})

describe('the difference between two versions of a text', () => {
  it('is nothing for the same text', () => {
    expect(diffText('Same. Text.', 'Same. Text.')).toEqual([])
  })

  it('lists the sentences that went and came, with the sentence before them', () => {
    const hunks = diffText('Mara keeps the ferry. Her brother Joss sails the grey boat. The bell rings at dawn.', 'Mara keeps the ferry. Her sister Ilka sails the red boat. The bell rings at dawn. A fog horn sounds at night.')
    expect(hunks).toEqual([
      { after: 'Mara keeps the ferry.', removed: 'Her brother Joss sails the grey boat.', added: 'Her sister Ilka sails the red boat.' },
      { after: 'The bell rings at dawn.', removed: '', added: 'A fog horn sounds at night.' },
    ])
  })

  it('reads Chinese sentences and lines', () => {
    const hunks = diffText('玛拉守着渡口。她的哥哥乔斯驾着灰船。', '玛拉守着渡口。她的哥哥乔斯驾着红船。')
    expect(hunks).toEqual([{ after: '玛拉守着渡口。', removed: '她的哥哥乔斯驾着灰船。', added: '她的哥哥乔斯驾着红船。' }])
  })

  it('says it cannot compare texts that are too long', () => {
    expect(diffText('a. '.repeat(2000), 'b. '.repeat(2000))).toBeUndefined()
  })
})

describe('what a card says about itself', () => {
  const card = (data: Partial<NormalizedCard>): NormalizedCard => ({ sourceSpec: 'chara_card_v3', name: 'Quay', description: '', personality: '', scenario: '', firstMessage: '', alternateGreetings: [], messageExample: '', creatorNotes: '', systemPrompt: '', postHistoryInstructions: '', tags: ['harbour'], creator: 'someone', characterVersion: '1', ignored: { scripts: 0, extensions: [] }, ...data })

  it('lists the name, creator, version and tags that changed', () => {
    expect(cardChanges(card({}), card({}))).toEqual([])
    expect(cardChanges(card({}), card({ characterVersion: '2', tags: ['harbour', 'autumn'] }))).toEqual(['version: “1” → “2”', 'tags: “harbour” → “harbour, autumn”'])
  })
})

describe('what a newer card changes about the world itself', () => {
  const base: NormalizedCard = {
    sourceSpec: 'chara_card_v3', name: 'Quay', description: 'A quay.', personality: '', scenario: 'Autumn.', firstMessage: 'Fog.', alternateGreetings: ['Dusk.'], messageExample: '', creatorNotes: '',
    systemPrompt: '', postHistoryInstructions: '', tags: ['harbour'], creator: 'someone', characterVersion: '1', ignored: { scripts: 0, extensions: [] },
  }
  const first: ImportChoices = { name: 'Quay', disabledEntries: [], opening: { kind: 'first' } }
  const changed = (card: Partial<NormalizedCard>, choices: ImportChoices = first) => worldFieldChanges({ card: base, choices: first }, { card: { ...base, ...card }, choices }).map(change => change.field)

  it('is nothing when nothing the world keeps for itself changed', () => {
    expect(changed({})).toEqual([])
    expect(changed({ characterVersion: '2', personality: 'warm', messageExample: 'x' })).toEqual([])
  })

  it('names the field of the world each change belongs to', () => {
    expect(changed({ scenario: 'Winter.' })).toEqual(['description'])
    expect(changed({ creatorNotes: 'Play slowly.' })).toEqual(['description'])
    expect(changed({ tags: ['harbour', 'storm'] })).toEqual(['tags'])
    expect(changed({ creator: 'someone else' })).toEqual(['authorName'])
    expect(changed({ firstMessage: 'Gulls.' })).toEqual(['opening'])
    expect(changed({ alternateGreetings: ['Dusk.', 'Night.'] })).toEqual(['alternateOpenings'])
  })

  it('suggests the greetings as the import writes them, without the card\'s markup', () => {
    const found = worldFieldChanges({ card: base, choices: first }, { card: { ...base, firstMessage: '*Gulls* cry.', alternateGreetings: ['*Dusk* falls.'] }, choices: first })
    expect(found.find(change => change.field === 'opening')?.suggested).toBe('Gulls cry.')
    expect(found.find(change => change.field === 'alternateOpenings')?.suggested).toEqual([{ title: 'Alternate 1', text: 'Dusk falls.' }])
  })

  it('follows the greeting the world opens with: the one chosen is the opening, the others are alternates', () => {
    const alternate: ImportChoices = { ...first, opening: { kind: 'alternate', index: 0 } }
    expect(worldFieldChanges({ card: base, choices: alternate }, { card: { ...base, alternateGreetings: ['Dawn.'] }, choices: alternate }).map(change => change.field)).toEqual(['opening'])
    expect(worldFieldChanges({ card: base, choices: alternate }, { card: { ...base, firstMessage: 'Gulls.' }, choices: alternate }).map(change => change.field)).toEqual(['alternateOpenings'])
  })
})
