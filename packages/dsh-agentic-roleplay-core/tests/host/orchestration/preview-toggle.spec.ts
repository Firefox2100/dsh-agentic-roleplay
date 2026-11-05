import { describe, expect, it } from 'vitest'
import { registerConditionalTools } from '../../../src/host/orchestration/hooks.ts'

function fakeAgent() {
  const registered = new Map<string, () => boolean>()
  const agent = { ctx: { tools: { register: (tool: { name: string }, options: { when?: () => boolean } = {}) => {
    if (registered.has(tool.name)) throw new Error(`tool "${tool.name}" is already registered in this scope`)
    registered.set(tool.name, options.when ?? (() => true))
    return () => { registered.delete(tool.name) }
  } } } }
  const offered = () => [...registered].filter(([, when]) => when()).map(([name]) => name).sort()
  return { agent: agent as never, registered, offered }
}

const entry = (name: string, when: () => boolean) => ({ tool: { name } as never, when })

describe('the switchable tools of an agent', () => {
  it('are registered once with their condition, and offered only while the condition holds', () => {
    const { agent, registered, offered } = fakeAgent()
    const on = { preview: true, dice: false }
    const entries = [entry('preview_scene', () => on.preview), entry('roll_dice', () => on.dice)]
    registerConditionalTools(agent, entries)
    registerConditionalTools(agent, entries)
    expect([...registered.keys()].sort()).toEqual(['preview_scene', 'roll_dice'])
    expect(offered()).toEqual(['preview_scene'])
    on.preview = false
    on.dice = true
    expect(offered()).toEqual(['roll_dice'])
  })

  it('are not registered a second time by a plugin that was reloaded', () => {
    const { agent, registered } = fakeAgent()
    ;(agent as { ctx: { tools: { register: (tool: { name: string }) => void } } }).ctx.tools.register({ name: 'roll_dice' })
    expect(() => { registerConditionalTools(agent, [entry('roll_dice', () => true)]) }).not.toThrow()
    expect([...registered.keys()]).toEqual(['roll_dice'])
  })
})
