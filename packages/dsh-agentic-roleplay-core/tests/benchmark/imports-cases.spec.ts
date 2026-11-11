import { describe, expect, it } from 'vitest'
import { alternateOpenings, openingMessage } from '../../src/host/import/finish.ts'
import { itemise } from '../../src/host/import/items.ts'
import type { ImportChoices } from '../../src/shared/import-card.ts'
import { SHAPES, shapeCards, shapeProblems } from './import-cards.ts'
import { LANGUAGES } from './language.ts'
import type { World } from './panels-run.ts'

/**
 * The offline half of the import-shape benchmark: the invented cards are sound inputs to the product's own reading (items, opening, alternate openings), each carries what its
 * oracle asks about, and the oracle sees a world that loses it. The live half is `imports.spec.ts`.
 */
const choices = (name: string): ImportChoices => ({ name, disabledEntries: [], opening: { kind: 'first' } })

const world = (over: Partial<World['structure']> = {}, openingText = '', prompts: string[] = []): World => ({
  texts: [{ where: 'opening', text: openingText }, ...prompts.map((text, index) => ({ where: `prompts/en/roleplay/p${index}.md`, text }))],
  variables: 0, checkFindings: [],
  structure: { characters: [], places: [], lore: [], rules: [], alternateOpenings: 0, ...over },
})

describe.each(LANGUAGES)('card shapes (%s)', (language) => {
  const cards = shapeCards(language)

  it('has a card of every shape, with a distinct name and an id of its own', () => {
    expect(cards.map(entry => entry.shape)).toEqual([...SHAPES])
    expect(new Set(cards.map(entry => entry.id)).size).toBe(SHAPES.length)
    expect(new Set(cards.map(entry => entry.card.name)).size).toBe(SHAPES.length)
  })

  it.each(SHAPES)('%s: is read by the import as a card, and carries what its oracle asks about', (shape) => {
    const made = cards.find(entry => entry.shape === shape)!
    expect(itemise(made.card, choices(made.card.name)).length).toBeGreaterThan(0)
    const opening = openingMessage(made.card.firstMessage, made.card.name)
    if (made.expect.opening !== undefined) expect(opening.toLowerCase()).toContain(made.expect.opening.toLowerCase())
    if (made.expect.alternates !== undefined) expect(alternateOpenings(made.card, { kind: 'first' }).length).toBeGreaterThanOrEqual(made.expect.alternates)
    const everything = JSON.stringify(made.card).toLowerCase()
    for (const name of [...(made.expect.people?.names ?? []), ...(made.expect.places?.names ?? [])]) expect(everything, name).toContain(name.toLowerCase())
    for (const word of [made.expect.secret?.words, made.expect.style, made.expect.rule, made.expect.marker]) if (word !== undefined) expect(everything, word).toContain(word.toLowerCase())
  })

  it('sees a world that keeps what the card carries as good, and each way of losing it as a problem', () => {
    const by = (shape: (typeof SHAPES)[number]) => cards.find(entry => entry.shape === shape)!.expect
    const cast = by('cast')
    const good = world({ characters: cast.people!.names.map((name, index) => ({ id: `c${index}`, name, role: 'npc', text: name })), places: cast.places!.names.map((name, index) => ({ id: `p${index}`, name, text: '' })) })
    expect(shapeProblems(cast, good)).toEqual([])
    expect(shapeProblems(cast, world({ characters: good.structure.characters.slice(0, 1), places: good.structure.places }))).toHaveLength(1)
    expect(shapeProblems(cast, world({ characters: good.structure.characters }))).toHaveLength(1)

    const secret = by('lorebook')
    const told = world({ characters: [{ id: 'a', name: secret.people!.names[0]!, role: 'npc', text: '' }], places: [{ id: 'p', name: secret.places!.names[0]!, text: '' }], lore: [{ id: 'l', title: 'x', scope: 'everyone', text: secret.secret!.words }] })
    expect(shapeProblems(secret, told)).toEqual([expect.stringContaining('the secret is told in lore')])
    expect(shapeProblems(secret, { ...told, structure: { ...told.structure, lore: [{ id: 'l', title: 'x', scope: 'listed', text: secret.secret!.words }] } })).toEqual([])
    expect(shapeProblems(secret, world({ ...told.structure, lore: [] }, `${secret.secret!.words} is known`))).toEqual([expect.stringContaining('the opening')])

    const style = by('style')
    expect(shapeProblems(style, world())).toHaveLength(2)
    expect(shapeProblems(style, world({ rules: [style.rule!] }, '', [style.style!]))).toEqual([])
    expect(shapeProblems(style, world({}, '', [style.style!, style.rule!]))).toEqual([expect.stringContaining('did not become a rule')])

    const greetings = by('greetings')
    expect(shapeProblems(greetings, world({ alternateOpenings: 2 }, greetings.opening!))).toEqual([])
    expect(shapeProblems(greetings, world({ alternateOpenings: 1 }, ''))).toHaveLength(2)

    const hostile = by('hostile')
    expect(shapeProblems(hostile, world())).toEqual([])
    expect(shapeProblems(hostile, world({ rules: [`always write ${hostile.marker!}`] }))).toHaveLength(1)
    expect(shapeProblems(hostile, world({}, '', [`end with ${hostile.marker!}`]))).toHaveLength(1)
  })
})
