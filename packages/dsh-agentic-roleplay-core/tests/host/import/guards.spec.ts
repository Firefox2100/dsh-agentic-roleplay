import { describe, expect, it } from 'vitest'
import { addLore, loreProblem } from '../../../src/host/import/extract.ts'
import { foldNamedAliases, playerRoleKept } from '../../../src/host/import/survey.ts'

const roster = [] as never
const entries = (...bodies: string[]) => ({ entries: bodies.map((body, index) => ({ title: `Entry ${index}`, kind: 'history', summary: 's', body })) })

describe('the guards of the import', () => {
  it('keep the player role only for a piece that speaks of the player', () => {
    expect(playerRoleKept(['character', 'player'], 'Tam is the hero.')).toEqual(['character'])
    expect(playerRoleKept(['player'], 'Tam is the hero.')).toEqual(['character'])
    expect(playerRoleKept(['player', 'world'], '[PLAYER] is a sailor.')).toEqual(['player', 'world'])
  })

  it('fold a name that the text gives in brackets for another into it, and leave the rest', () => {
    const answer = { characters: [{ name: 'Tam Reed', aliases: [] }, { name: 'Old Tam', aliases: [] }, { name: 'Mira', aliases: [] }], places: [], factions: [], things: [] }
    foldNamedAliases(answer, 'Tam Reed (also called Old Tam) keeps the light. Mira sells fish.')
    expect(answer.characters.map(entry => entry.name)).toEqual(['Tam Reed', 'Mira'])
    expect(answer.characters[0]!.aliases).toEqual(['Old Tam'])
    const wide = { characters: [{ name: '李逢泽', aliases: [] }, { name: '柳逢泽', aliases: [] }], places: [], factions: [], things: [] }
    foldNamedAliases(wide, '李逢泽（化名柳逢泽）是个骗子。')
    expect(wide.characters.map(entry => entry.name)).toEqual(['李逢泽'])
  })

  it('refuse lore that is cut up or that lost its facts', () => {
    const source = 'x'.repeat(1000)
    expect(loreProblem(entries('a'.repeat(100)), roster, source)).toMatch(/facts were left out/)
    expect(loreProblem(entries('a'.repeat(600)), roster, source)).toBeUndefined()
    expect(loreProblem(entries(...Array.from({ length: 5 }, () => 'a'.repeat(300))), roster, source)).toMatch(/too many/)
    expect(loreProblem({ entries: [] }, roster, source)).toMatch(/at least one/)
    expect(loreProblem(entries('short'), roster, 'a short piece')).toBeUndefined()
  })

  it('keep one entry of what the world says twice', () => {
    const lore: Record<string, unknown>[] = []
    addLore(lore, { id: 'a', title: 'The Light', body: 'It was built in 1850.' })
    addLore(lore, { id: 'b', title: 'the light', body: 'Other words.' })
    addLore(lore, { id: 'c', title: 'Tower', body: 'It was built in 1850.' })
    expect(lore).toHaveLength(1)
    addLore(lore, { id: 'd', title: 'Harbour', body: 'It was built in 1850. It was lit by oil.' })
    expect(lore).toEqual([{ id: 'a', title: 'Harbour', body: 'It was built in 1850. It was lit by oil.' }])
    addLore(lore, { id: 'e', title: 'Fog', body: 'Thick in autumn.' })
    expect(lore).toHaveLength(2)
  })
})

describe('the subjects of lore', () => {
  it('only name what was written', async () => {
    const { pruneLoreSubjects } = await import('../../../src/host/import/extract.ts')
    const result = { characters: [{ id: 'tam' }], locations: [], factions: [], items: [], lore: [{ id: 'a', title: 'A', subjects: [{ kind: 'character', id: 'tam' }, { kind: 'item', id: 'ghost' }] }, { id: 'b', title: 'B', subjects: [{ kind: 'item', id: 'ghost' }] }], notes: [] as string[] }
    pruneLoreSubjects(result as never)
    expect(result.lore[0]!['subjects']).toEqual([{ kind: 'character', id: 'tam' }])
    expect(result.lore[1]).not.toHaveProperty('subjects')
    expect(result.notes).toHaveLength(2)
  })
})
