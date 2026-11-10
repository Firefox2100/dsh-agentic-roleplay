import { describe, expect, it } from 'vitest'
import { dialectOf } from '../../src/host/import/dialect.ts'
import { openingMessage, alternateOpenings } from '../../src/host/import/finish.ts'
import { itemise } from '../../src/host/import/items.ts'
import { findPanel, panelsOfCard, withoutOutputMarkup } from '../../src/host/import/panels.ts'
import { exactUtterances } from '../../src/host/orchestration/defaults.ts'
import { checkedOutput } from '../../src/host/orchestration/delivery.ts'
import type { TurnState } from '../../src/host/orchestration/turn-state.ts'
import type { ImportChoices } from '../../src/shared/import-card.ts'
import { LANGUAGES } from './language.ts'
import { PANEL_STYLES, leakedNarration, leaks, panelCards } from './panel-cards.ts'

/**
 * The offline half of the status-panel benchmark: the deterministic parts of an import and of delivery, run on invented cards of every panel style in both languages and
 * scored by an oracle of the benchmark's own (`leaks`). The live half is `panels.spec.ts`. A panel that reaches the world, or the story, fails here first.
 */
const CHOICES: ImportChoices = { name: 'Lamp Quay', disabledEntries: [], opening: { kind: 'first' } }
const state = (): TurnState => ({ utterances: [], refused: 0 }) as unknown as TurnState
const narration = (text: string) => [{ type: 'narration' as const, text }]

describe.each(LANGUAGES)('status panels of community cards (%s)', (language) => {
  const cards = panelCards(language)

  it('has a card of every style, and the oracle sees the panel in each place it is planted', () => {
    expect(cards.map(card => card.style)).toEqual([...PANEL_STYLES])
    for (const { card, style, filled, demanding } of cards) {
      if (style !== 'state') expect(leaks(filled), `${style}: the filled panel`).toBe(true)
      for (const id of demanding) expect(leaks(card.book!.entries.find(entry => entry.id === id)!.content) || style === 'tags', `${style}: ${id}`).toBe(true)
    }
    expect(leaks('The fog lifts from the pier, and "Two silver," she says.')).toBe(false)
    expect(leaks('Wren said {{user}} could come in.')).toBe(false)
  })

  describe.each(PANEL_STYLES)('%s', (style) => {
    const made = cards.find(entry => entry.style === style)!

    it('leaves the opening and the alternate openings of the world without the panel', () => {
      expect(leaks(openingMessage(made.card.firstMessage, made.card.name)), 'opening').toBe(false)
      for (const alternate of alternateOpenings(made.card, { kind: 'alternate', index: 0 })) expect(leaks(alternate.text), alternate.title).toBe(false)
      expect(openingMessage(made.card.firstMessage, made.card.name).length).toBeGreaterThan(20)
    })

    it('reads no panel into the pieces the entities and the background are made from', () => {
      for (const item of itemise(made.card, CHOICES)) {
        const always = made.card.book!.entries.some(entry => entry.id === item.id.split('#')[0] && made.demanding.includes(entry.id))
        if (!always) expect(leaks(item.text), item.id).toBe(false)
      }
    })

    it('hands the panels the card shows to the variable job, so the values are found even where no entry describes them', () => {
      if (style === 'state') expect(panelsOfCard(made.card)).toEqual([])
      else expect(panelsOfCard(made.card).length).toBeGreaterThan(0)
    })

    it('takes the sentences that tell the game master to print the panel out of every always-on entry, and the check finds what the raw entry holds', () => {
      for (const id of made.demanding) {
        const content = made.card.book!.entries.find(entry => entry.id === id)!.content
        expect(leaks(withoutOutputMarkup(content)), id).toBe(false)
        expect(findPanel(withoutOutputMarkup(content)), id).toBeUndefined()
      }
      const raw = made.demanding.map(id => made.card.book!.entries.find(entry => entry.id === id)!.content).join('\n')
      if (style !== 'fence' && style !== 'html') expect(findPanel(raw)).toBeDefined()
    })

    it('is sent back once to a game master that imitates the opening, and cut out of what it delivers after two refusals; the story and every utterance stay', () => {
      const story = made.card.firstMessage.split('\n\n')[0]!
      const segments = [...narration(leakedNarration(made)), { type: 'utterance' as const, character: 'wren', name: 'Wren', text: '"Two silver."' }]
      const first = state()
      expect(() => checkedOutput({ ...exactUtterances }, language, first, segments, false)).toThrow(/status bar, panel or block of tags/)
      expect(first.refused).toBe(1)
      const settled = { ...state(), refused: 2, utterances: [{ character: 'wren', text: '"Two silver."', round: 1 }] } as unknown as TurnState
      const out = checkedOutput({ ...exactUtterances }, language, settled, segments, false)
      const spoken = out.segments.flatMap(segment => (segment.type === 'utterance' ? [segment.text] : []))
      expect(out.segments.flatMap(segment => (segment.type === 'narration' ? [segment.text] : [])).some(text => leaks(text))).toBe(false)
      expect(out.segments.some(segment => segment.type === 'narration' && segment.text.includes(story.slice(0, 12)))).toBe(true)
      expect(spoken).toEqual(['"Two silver."'])
      expect(out.repaired).toBe(true)
    })

    it('lets a game master that writes only the story through untouched', () => {
      const out = checkedOutput({ ...exactUtterances }, language, state(), narration(made.card.firstMessage.split('\n\n')[0]!), false)
      expect(out.repaired).toBe(false)
    })
  })

  it('counts the scripts of the tags style and the invented tags as the card\'s dialect, and runs none', () => {
    const tags = cards.find(entry => entry.style === 'tags')!
    expect(dialectOf(tags.card)).toMatchObject({ regexScripts: 1, helperScripts: 1 })
    expect(dialectOf(tags.card).tags.length).toBeGreaterThan(3)
  })
})
