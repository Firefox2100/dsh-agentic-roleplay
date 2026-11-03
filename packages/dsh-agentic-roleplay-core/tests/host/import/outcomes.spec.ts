import { describe, expect, it } from 'vitest'
import type { ImportChoices, NormalizedCard } from '../../../src/shared/import-card.ts'
import { cardPieces, entitiesByPiece, type Source } from '../../../src/host/import/card-tools.ts'
import { outcomeCounts, pieceOutcomes } from '../../../src/host/import/outcomes.ts'

const card: NormalizedCard = {
  sourceSpec: 'chara_card_v3', name: 'Quay', description: 'Mara keeps the ferry.', personality: '', scenario: 'Autumn on the quay.', firstMessage: 'The ferry bell rings.', alternateGreetings: [],
  messageExample: '', creatorNotes: 'Notes for the one who plays this.', systemPrompt: 'Write in the second person.', postHistoryInstructions: '', tags: [], creator: 'someone', characterVersion: '1', ignored: { scripts: 0, extensions: [] },
  book: { name: '', description: '', entries: [
    { id: 'entry:0', title: 'Fog', keys: [], secondaryKeys: [], content: 'Fog sits on the water.', enabled: true, constant: false, selective: false, position: '' },
    { id: 'entry:1', title: 'Format', keys: [], secondaryKeys: [], content: '<status>hp</status>', enabled: true, constant: false, selective: false, position: '' },
    { id: 'entry:2', title: 'Rule', keys: [], secondaryKeys: [], content: 'Never skip a scene.', enabled: true, constant: false, selective: false, position: '' },
    { id: 'entry:3', title: 'Off', keys: [], secondaryKeys: [], content: 'Left off.', enabled: true, constant: false, selective: false, position: '' },
  ] },
}
const choices: ImportChoices = { name: 'Quay', disabledEntries: ['entry:3'], opening: { kind: 'first' } }
const classified = {
  'field:description': { roles: ['character'], targets: [{ name: 'Mara', kind: 'character' }] },
  'field:scenario': { roles: ['scenario'], targets: [] },
  'entry:0': { roles: ['world'], targets: [] },
  'entry:1': { roles: ['template'], targets: [] },
  'entry:2': { roles: ['instruction'], targets: [] },
}
const roster = [{ kind: 'character', key: 'mara', name: 'Mara', aliases: [], player: false }]
const source = (records: Source['records'], picked = choices): Source => ({ card, choices: picked, pieces: cardPieces(card, picked), records }) as Source

describe('what became of each piece of a card', () => {
  const finished = source({ classified, roster, report: { counts: {} } } as never)
  const byPiece = Object.fromEntries(pieceOutcomes(finished, entitiesByPiece(finished)).map(entry => [entry.piece, entry]))

  it('says which pieces made things, which were only read, and which became guidance or were left out', () => {
    expect(byPiece['field:description']).toMatchObject({ outcome: 'converted', madeInto: ['Mara'] })
    expect(byPiece['field:scenario']).toMatchObject({ outcome: 'read' })
    expect(byPiece['entry:0']).toMatchObject({ outcome: 'read' })
    expect(byPiece['entry:1']).toMatchObject({ outcome: 'omitted' })
    expect(byPiece['entry:2']).toMatchObject({ outcome: 'guidance' })
    expect(byPiece['field:system-prompt']).toMatchObject({ outcome: 'guidance' })
    expect(byPiece['field:creator-notes']).toMatchObject({ outcome: 'omitted' })
    expect(byPiece['field:first-message']).toMatchObject({ outcome: 'carried' })
    expect(byPiece['entry:3']).toMatchObject({ outcome: 'omitted', because: 'left off by the person' })
  })

  it('counts them, and says awaiting for a card the import has not reached', () => {
    expect(outcomeCounts(Object.values(byPiece)).converted).toBe(1)
    const early = pieceOutcomes(source({}), new Map())
    expect(early.find(entry => entry.piece === 'entry:0')?.outcome).toBe('awaiting')
    expect(early.find(entry => entry.piece === 'field:first-message')?.outcome).toBe('awaiting')
  })

  it('leaves out the opening when the person chose none', () => {
    const none = source({ classified, roster, report: { counts: {} } } as never, { ...choices, opening: { kind: 'none' } })
    expect(pieceOutcomes(none, new Map()).find(entry => entry.piece === 'field:first-message')?.outcome).toBe('omitted')
  })
})
