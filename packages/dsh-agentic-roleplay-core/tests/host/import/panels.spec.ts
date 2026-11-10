import { describe, expect, it } from 'vitest'
import { readCard } from '../../../src/host/import/card.ts'
import { extractStyleFrom, extractVariables, loreDocuments } from '../../../src/host/import/extract.ts'
import { openingMessage } from '../../../src/host/import/finish.ts'
import { itemise } from '../../../src/host/import/items.ts'
import { panelsOfCard, splitPanels, withoutLeftOut, withoutOutputMarkup } from '../../../src/host/import/panels.ts'
import { v3Card } from '../../support/cards.ts'
import { fakeContext } from '../../support/jobs.ts'

const BAR = 'Day 3 | Place: Pier | Trust: 20/100 | Coins: 15'
const story = 'The horn sounds across the water.\n\n"Two coins," she says.'

describe('status bars in a card message', () => {
  it('are taken out of a fenced block, with the story left whole', () => {
    expect(splitPanels(`${story}\n\n\`\`\`\n${BAR}\n\`\`\``)).toEqual({ prose: story, panels: [BAR] })
  })

  it('are taken out of a short block of markup that carries numbers, but not a message wrapped whole in markup', () => {
    const panel = '<div class="status"><b>Day 1</b> · Trust <span>10</span>/100</div>'
    expect(splitPanels(`${story}\n\n${panel}`)).toEqual({ prose: story, panels: [panel] })
    const wrapped = `<div class="note">${story} At 7 o'clock.</div>`
    expect(splitPanels(wrapped)).toEqual({ prose: wrapped, panels: [] })
  })

  it('are taken out of a closing line of values set apart by bars, and a story line with a bar is kept', () => {
    expect(splitPanels(`${story}\n\n${BAR}`)).toEqual({ prose: story, panels: [BAR] })
    expect(splitPanels(`${story}\n\nShe weighs the coins | and waits.`).panels).toEqual([])
  })

  it('leave the opening of the world and the pieces read from the card without the bar', () => {
    const card = readCard(Buffer.from(JSON.stringify(v3Card({ first_mes: `${story}\n\n\`\`\`\n${BAR}\n\`\`\``, mes_example: `<START>\n{{user}}: Hi\n{{char}}: "Hello."\n\`\`\`\n${BAR}\n\`\`\`` }))), 'x.json')
    expect(openingMessage(card.firstMessage, card.name)).toBe(story)
    const items = itemise(card, { name: 'x', disabledEntries: [], opening: { kind: 'first' } })
    expect(items.map(entry => entry.text).join('\n')).not.toContain('Trust')
    expect(panelsOfCard(card)).toEqual([BAR])
  })
})

describe('the status bars of a card as a source of its variables', () => {
  it('are given to the variable job even when the card has no entry that describes them', async () => {
    const card = readCard(Buffer.from(JSON.stringify(v3Card({ first_mes: `${story}\n\n\`\`\`\n${BAR}\n\`\`\`` }))), 'x.json')
    const asked = fakeContext(() => ({ variables: [], left_out: [] }))
    await extractVariables(asked, card, [], {}, [])
    expect(asked.asked).toHaveLength(1)
    expect(asked.asked[0]!.prompt).toContain(BAR)
  })
})

describe('what the style job lists as left out', () => {
  const leftOut = ['End every reply with a status bar in a code block (Day N | Place: X | Trust: N/100)']

  it('is not kept in the style, even when the model wrote it into the same line', () => {
    const style = 'Write short paragraphs.\nAlways end every reply with a status bar in a code block, exactly in this format: Day N | Place: X | Trust: N/100. Never skip it. Keep a dry tone.'
    expect(withoutLeftOut(style, leftOut)).toBe('Write short paragraphs.\nKeep a dry tone.')
  })

  it('does the same for Chinese, and leaves a style that shares only a word with it', () => {
    expect(withoutLeftOut('语气克制。\n每次回复结尾都要附上一个状态栏。', ['每次回复结尾附上状态栏代码块'])).toBe('语气克制。')
    expect(withoutLeftOut('Describe the status of the harbour in the narration.', leftOut)).toBe('Describe the status of the harbour in the narration.')
    expect(withoutLeftOut('Short answers.', ['formats'])).toBe('Short answers.')
  })

  it('reaches the prompts the style job writes', async () => {
    const ctx = fakeContext(() => ({ narration: 'Be concise. Always end every reply with a status bar in a code block.', characters: '', left_out: leftOut, persona_names: [] }))
    const made = await extractStyleFrom(ctx, 'Card', ['Always end every reply with a status bar in a code block.'])
    expect(made.prompts).toEqual([{ id: 'roleplay/style', text: 'Be concise.' }])
  })
})

describe('the standing rules of a card', () => {
  it('lose the sentences that tell the game master to print markup or an update call, and keep the rule itself', () => {
    const rule = "After each reply output an <UpdateVariable> block with lines like _.set('trust', 20, 25). Trust rises by 5 when the player is kind."
    expect(withoutOutputMarkup(rule)).toBe('Trust rises by 5 when the player is kind.')
    expect(withoutOutputMarkup('A roll of 96 or more is a fumble.')).toBe('A roll of 96 or more is a fumble.')
  })
})

describe('the background a card gives', () => {
  it('loses what tells the game master to print markup, and an entry that is only that is not made', () => {
    const entries = [
      { title: 'Variable rules', kind: 'other', summary: '', body: "After each reply output an <UpdateVariable> block with lines like _.set('trust', 20, 25)." },
      { title: 'East bank', kind: 'place', summary: 'The bank.', body: 'Fog sits low here. Output a ```status``` block after every reply.' },
    ]
    const made = loreDocuments({ entries }, [], new Set())
    expect(made.map(built => [built.document['title'], built.document['body']])).toEqual([['East bank', 'Fog sits low here.']])
  })
})
