import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import { AuthoringTools, limitAuthoringAgent } from '../../../src/host/tools/authoring-tools.ts'
import type { Switchboard } from '../../../src/shared/settings.ts'

const registry = (...names: string[]) => ({ schemas: () => names.map(name => ({ name, description: `the ${name} tool` })) })
const global = registry('mcp__search__web', 'mcp__db__query', 'bash', 'get_character', 'run_code')

function service(board: () => Switchboard): AuthoringTools {
  const ctx = new Context()
  return new AuthoringTools(ctx, board)
}

describe('the tools of other plugins the authoring assistants are given', () => {
  it('are none unless the settings give them, and never those of the story or the reserved transport', () => {
    const tools = service(() => ({}))
    expect(tools.withheld(global, 'worldAuthoring')).toEqual(['bash', 'mcp__db__query', 'mcp__search__web'])
    expect(tools.withheld(global, 'lorebookAuthoring')).toEqual(['bash', 'mcp__db__query', 'mcp__search__web'])
  })

  it('are given to the assistant they were switched on for and to no other', () => {
    const tools = service(() => ({ worldAuthoring: { mcp__search__web: true }, lorebookAuthoring: { mcp__search__web: true, mcp__db__query: true, gone: true } }))
    expect(tools.withheld(global, 'worldAuthoring')).toEqual(['bash', 'mcp__db__query'])
    expect(tools.withheld(global, 'lorebookAuthoring')).toEqual(['bash'])
    expect(tools.withheld(global, 'presetAuthoring')).toEqual(['bash', 'mcp__db__query', 'mcp__search__web'])
  })

  it('follow the settings as they change, with nothing remembered', () => {
    let board: Switchboard = {}
    const tools = service(() => board)
    expect(tools.withheld(global, 'worldAuthoring')).toContain('mcp__search__web')
    board = { worldAuthoring: { mcp__search__web: true } }
    expect(tools.withheld(global, 'worldAuthoring')).not.toContain('mcp__search__web')
  })
})

describe('what is taken away from an assistant', () => {
  const agent = (names: string[]) => {
    const denied: string[][] = []
    const held = { ctx: { tools: { ...registry(...names), restrict: ({ deny }: { deny: string[] }) => { denied.push(deny); return () => undefined } } } } as never
    return { held, denied }
  }

  it('is every tool of other plugins it was not given, set before its first request and not again while nothing changes', () => {
    const tools = service(() => ({ worldAuthoring: { mcp__search__web: true } }))
    const { held, denied } = agent(['mcp__search__web', 'bash', 'mcp__db__query'])
    limitAuthoringAgent(held, 'worldAuthoring', tools)
    limitAuthoringAgent(held, 'worldAuthoring', tools)
    expect(denied).toEqual([['bash', 'mcp__db__query']])
  })

  it('includes a server that connects later, at the next step', () => {
    const tools = service(() => ({}))
    const names = ['bash']
    const denied: string[][] = []
    const held = { ctx: { tools: { schemas: () => names.map(name => ({ name, description: '' })), restrict: ({ deny }: { deny: string[] }) => { denied.push(deny); return () => undefined } } } } as never
    limitAuthoringAgent(held, 'presetAuthoring', tools)
    names.push('mcp__search__web')
    limitAuthoringAgent(held, 'presetAuthoring', tools)
    expect(denied).toEqual([['bash'], ['bash', 'mcp__search__web']])
  })
})
