import { describe, expect, it } from 'vitest'
import { readCard } from '../../../src/host/import/card.ts'
import { MAX_ITEM_CHARS, cleanText, itemise, partsOf, playerWord, withPlayer } from '../../../src/host/import/items.ts'
import { defaultChoices } from '../../../src/host/import/store.ts'
import { v3Card } from '../../support/cards.ts'

const card = (data: Record<string, unknown> = {}) => readCard(Buffer.from(JSON.stringify(v3Card(data))), 'x.json')

describe('the text a model reads', () => {
  it('has the macros of the card\'s tool replaced: the card\'s name for the character, the same marker for the player, no comments or example markers', () => {
    expect(cleanText('{{char}} greets <user>.\r\n<START>\n<!-- hidden -->\n{{// note}}Hello {{ User }}.\n\n\n\nEnd', 'Mira')).toBe('Mira greets [PLAYER].\n\nHello [PLAYER].\n\nEnd')
  })

  it('is cut into parts at the end of a paragraph, a line or a sentence, and never longer than asked', () => {
    const text = `${'a'.repeat(60)}\n\n${'b'.repeat(60)}\n${'c'.repeat(60)}`
    expect(partsOf(text, 100)).toEqual([`${'a'.repeat(60)}`, `${'b'.repeat(60)}`, `${'c'.repeat(60)}`])
    expect(partsOf('x'.repeat(250), 100).map(part => part.length)).toEqual([100, 100, 50])
    expect(partsOf('short')).toEqual(['short'])
    expect(partsOf('')).toEqual([])
  })

  it('names the player with the character when there is one, otherwise with a word in the script of the text', () => {
    expect(withPlayer('{{user}} waits.', 'Ana')).toBe('Ana waits.')
    expect(withPlayer('{{user}} waits.')).toBe('the player waits.')
    expect(withPlayer('{{user}}等待。')).toBe('玩家等待。')
    expect(playerWord('x', 'Ana')).toBe('Ana')
  })
})

describe('the pieces of a card', () => {
  it('are its fields, the opening that was chosen and the lorebook entries left on, without the instructions to the narrator', () => {
    const source = card({ system_prompt: 'Write in the second person.', post_history_instructions: 'Stay in character.', personality: 'Dry.', mes_example: '<START>\n{{user}}: Hi\n{{char}}: Hello', creator_notes: 'Made for fun.' })
    expect(itemise(source, defaultChoices(source)).some(item => item.text.includes('Made for fun'))).toBe(false)
    const items = itemise(source, defaultChoices(source))
    expect(items.map(item => item.id)).toEqual(['field:description', 'field:personality', 'field:scenario', 'field:example', 'field:opening', 'entry:0'])
    expect(items.find(item => item.id === 'field:example')?.text).toBe('[PLAYER]: Hi\nTest Harbour: Hello')
    expect(items.find(item => item.id === 'entry:0')).toMatchObject({ label: 'entry “Old Tam”', title: 'Old Tam', keys: ['Old Tam'] })
    expect(items.some(item => item.text.includes('second person') || item.text.includes('Stay in character'))).toBe(false)
  })

  it('leave out the entries that were switched off and the opening when there is none, and what is blank', () => {
    const source = card({ description: '  ', first_mes: 'Hello.' })
    expect(itemise(source, { name: 'W', disabledEntries: ['entry:0'], opening: { kind: 'none' } }).map(item => item.id)).toEqual(['field:scenario'])
  })

  it('cut a long entry into parts that keep its title and keys', () => {
    const source = card({ character_book: { entries: [{ comment: 'Long', keys: ['k'], content: `${'x'.repeat(MAX_ITEM_CHARS - 10)}\n\n${'y'.repeat(100)}` }] } })
    const parts = itemise(source, { name: 'W', disabledEntries: [], opening: { kind: 'none' } }).filter(item => item.id.startsWith('entry:'))
    expect(parts.map(item => [item.id, item.title, item.keys])).toEqual([['entry:0#1', 'Long', ['k']], ['entry:0#2', 'Long', ['k']]])
  })
})

describe('cleaning the text of a card that picks its text with code', () => {
  it('takes the EJS control code out and keeps the text of its branches', () => {
    expect(cleanText('Team: <%_ if (typeof x === "undefined") var x = getvar("a"); _%>\n<%_ if (x > 1) { _%>Ace<%_ } _%> and Bo<%= name %>.', 'Card')).toBe('Team: \nAce and Bo.')
    expect(cleanText('Plain <%# a comment %>text', 'Card')).toBe('Plain text')
  })
})
