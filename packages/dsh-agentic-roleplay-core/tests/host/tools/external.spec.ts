import { describe, expect, it } from 'vitest'
import { externalGiven, externalTools, externalWithheld, ownToolNames } from '../../../src/host/tools/external.ts'
import { externalToolLimit } from '../../../src/host/orchestration/hooks.ts'

const registry = (...names: string[]) => ({ schemas: () => names.map(name => ({ name, description: `the ${name} tool` })) })
const mixed = registry('bash', 'activate_characters', 'roll_dice', 'get_character', 'mcp__searx__search', 'run_code', 'preview_scene', 'fs_read')

describe('the tools other plugins registered for everyone', () => {
  it('are told apart from the story\'s own and from the reserved transport', () => {
    expect(ownToolNames().has('activate_characters')).toBe(true)
    expect(ownToolNames().has('roll_check')).toBe(true)
    expect(ownToolNames().has('get_character')).toBe(true)
    expect(externalTools(mixed).map(tool => tool.name)).toEqual(['bash', 'fs_read', 'mcp__searx__search'])
    expect(externalTools(mixed)[0]).toEqual({ name: 'bash', description: 'the bash tool' })
  })

  it('are given to the agents they were switched on for, and withheld from the rest', () => {
    const board = { gameMaster: { mcp__searx__search: true, gone_tool: true }, characters: { fs_read: true } }
    expect(externalGiven(mixed, board, 'gameMaster')).toEqual(['mcp__searx__search'])
    expect(externalGiven(mixed, board, 'characters')).toEqual(['fs_read'])
    expect(externalGiven(mixed, board, 'records')).toEqual([])
    expect(externalWithheld(mixed, board, 'gameMaster')).toEqual(['bash', 'fs_read'])
    expect(externalWithheld(mixed, {}, 'records')).toEqual(['bash', 'fs_read', 'mcp__searx__search'])
  })
})

describe('what is taken away from an agent', () => {
  const agent = () => {
    const lifted: string[][] = []
    const active: string[][] = []
    return { agent: { ctx: { tools: { restrict: ({ deny }: { deny: string[] }) => { active.push(deny); return () => { lifted.push(deny) } } } } } as never, active, lifted }
  }

  it('is set once however often it is asked, changed when the settings change, and lifted when nothing is withheld', () => {
    const { agent: held, active, lifted } = agent()
    externalToolLimit(held, ['bash', 'fs_read'])
    externalToolLimit(held, ['fs_read', 'bash'])
    expect(active).toEqual([['bash', 'fs_read']])
    externalToolLimit(held, ['bash'])
    expect(active).toEqual([['bash', 'fs_read'], ['bash']])
    expect(lifted).toEqual([['bash', 'fs_read']])
    externalToolLimit(held, [])
    expect(lifted).toEqual([['bash', 'fs_read'], ['bash']])
    expect(active).toHaveLength(2)
  })
})
