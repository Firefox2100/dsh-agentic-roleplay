import { describe, expect, it } from 'vitest'
import { readCard } from '../../../src/host/import/card.ts'
import { dialectOf, hasDialect, sourceSummary } from '../../../src/host/import/dialect.ts'
import { v3Card } from '../../support/cards.ts'

const card = (data: Record<string, unknown>) => readCard(Buffer.from(JSON.stringify(v3Card(data))), 'x.json')

describe('the machinery of the tool that made a card', () => {
  it('finds macros, tag blocks and scripts, and ignores the names of the player and the character and ordinary markup', () => {
    const found = dialectOf(card({
      description: 'Hello {{user}}, I am {{char}}. {{getvar::mood}} and {{Roll:1d6}} <b>bold</b>',
      first_mes: '<status>hp 3</status> text <STATUS>again</STATUS>',
      extensions: { regex_scripts: [{}, {}], tavern_helper: { scripts: [{}] } },
    }))
    expect(found).toEqual({ macros: ['getvar', 'roll'], tags: ['status'], regexScripts: 2, helperScripts: 1 })
    expect(hasDialect(found)).toBe(true)
  })

  it('finds nothing in a plain card', () => {
    const found = dialectOf(card({ description: 'A keeper of {{char}}.' }))
    expect(found).toEqual({ macros: [], tags: [], regexScripts: 0, helperScripts: 0 })
    expect(hasDialect(found)).toBe(false)
    expect(sourceSummary(card({}))).not.toMatch(/Nothing runs them/)
  })

  it('tells what is left out, in the language of the person', () => {
    const plain = card({ description: '{{getvar::x}}', extensions: { regex_scripts: [{}] } })
    expect(sourceSummary(plain)).toMatch(/V3 card with 1 lorebook entries.*1 regular expressions; macros \(getvar\)/)
    expect(sourceSummary(plain, 'zh')).toMatch(/V3 角色卡.*1 条正则表达式; 宏（getvar）/)
  })
})
