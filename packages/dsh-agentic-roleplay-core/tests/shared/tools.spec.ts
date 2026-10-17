import { describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS, parseSettings } from '../../src/shared/settings.ts'
import { OPTIONAL_TOOLS, switchesOf, toolEnabled, withSwitch } from '../../src/shared/tools.ts'
import { dictionaries } from '../../src/client/widgets/tool-switches/locales.ts'

describe('the optional tools of the agents', () => {
  it('has a tool on by default and off when a switch says so', () => {
    expect(toolEnabled({}, 'gameMaster', 'roll_dice')).toBe(true)
    expect(toolEnabled({ gameMaster: { roll_dice: false } }, 'gameMaster', 'roll_dice')).toBe(false)
  })

  it('never has a tool this version does not offer, and keeps what it is told of it', () => {
    expect(toolEnabled({ gameMaster: { search_the_web: true } }, 'gameMaster', 'search_the_web')).toBe(false)
    expect(toolEnabled({ wizard: { roll_dice: true } }, 'gameMaster', 'roll_dice')).toBe(true)
    const board = { gameMaster: { search_the_web: true, roll_dice: true }, wizard: { x: true } }
    expect(switchesOf(board).flatMap(entry => entry.tools.map(tool => tool.id))).toEqual(['roll_check', 'roll_dice', 'list_checks'])
    const next = withSwitch(board, 'gameMaster', 'roll_check', false)
    expect(next).toEqual({ gameMaster: { search_the_web: true, roll_dice: true, roll_check: false }, wizard: { x: true } })
    expect(withSwitch(next, 'gameMaster', 'roll_check', true)).toEqual(board)
    expect(() => withSwitch(board, 'gameMaster', 'search_the_web', false)).toThrow('there is no tool')
  })

  it('writes only what was chosen, and drops an agent with nothing chosen', () => {
    expect(withSwitch({}, 'gameMaster', 'roll_dice', true)).toEqual({})
    expect(withSwitch({ gameMaster: { roll_dice: false } }, 'gameMaster', 'roll_dice', true)).toEqual({})
  })

  it('has words for every tool it offers, in every language', () => {
    for (const locale of Object.keys(dictionaries) as (keyof typeof dictionaries)[]) {
      for (const tool of OPTIONAL_TOOLS) {
        expect(dictionaries[locale][`sw_tool_${tool.id}` as 'sw_title'], `${locale} ${tool.id}`).toBeTruthy()
        expect(dictionaries[locale][`sw_tool_${tool.id}_hint` as 'sw_title'], `${locale} ${tool.id} hint`).toBeTruthy()
      }
    }
  })

  it('is part of the settings: switches by kind of agent, with names this version does not know allowed', () => {
    expect(DEFAULT_SETTINGS.tools).toEqual({})
    expect(DEFAULT_SETTINGS.dice.visibility).toBe('card')
    const parsed = parseSettings({ tools: { gameMaster: { roll_dice: false, future_tool: true } }, dice: { visibility: 'hidden' } })
    expect(parsed).toMatchObject({ ok: true, value: { tools: { gameMaster: { roll_dice: false, future_tool: true } }, dice: { visibility: 'hidden' } } })
    for (const bad of [{ tools: [] }, { tools: { gameMaster: { roll_dice: 'yes' } } }, { tools: { 'bad name': {} } }, { tools: { gameMaster: 5 } }, { dice: { visibility: 'loud' } }]) {
      expect(parseSettings(bad).ok, JSON.stringify(bad)).toBe(false)
    }
  })
})

describe('the tools other plugins registered', () => {
  it('are off for an agent unless switched on, and a switch is kept only while it is on', async () => {
    const { externalEnabled, withExternal } = await import('../../src/shared/tools.ts')
    expect(externalEnabled({}, 'gameMaster', 'mcp__searx__search')).toBe(false)
    const on = withExternal({}, 'gameMaster', 'mcp__searx__search', true)
    expect(on).toEqual({ gameMaster: { mcp__searx__search: true } })
    expect(externalEnabled(on, 'gameMaster', 'mcp__searx__search')).toBe(true)
    expect(externalEnabled(on, 'characters', 'mcp__searx__search')).toBe(false)
    expect(withExternal(on, 'gameMaster', 'mcp__searx__search', false)).toEqual({})
    expect(withExternal({ gameMaster: { roll_dice: false, future: true } }, 'gameMaster', 'bash', true)).toEqual({ gameMaster: { roll_dice: false, future: true, bash: true } })
  })

  it('may be named as the plugins that register them name them', () => {
    for (const name of ['mcp__searx__search', 'fs.read', 'server:tool-name', 'Bash', 'tool-1']) {
      expect(parseSettings({ tools: { characters: { [name]: true } } }).ok, name).toBe(true)
    }
    for (const bad of ['', ' space', 'a'.repeat(81), '-leading', 'a/b']) {
      expect(parseSettings({ tools: { characters: { [bad]: true } } }).ok, bad).toBe(false)
    }
  })
})
