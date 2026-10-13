import { describe, expect, it } from 'vitest'
import { previewToggle } from '../../../src/host/orchestration/hooks.ts'

function fakeAgent() {
  const registered = new Set<string>()
  const agent = { ctx: { tools: { register: (tool: { name: string }) => {
    if (registered.has(tool.name)) throw new Error(`tool "${tool.name}" is already registered in this scope`)
    registered.add(tool.name)
    return () => { registered.delete(tool.name) }
  } } } }
  return { agent: agent as never, registered }
}

const tool = { name: 'preview_scene' } as never

describe('the preview tool of an agent', () => {
  it('is registered once however often it is shown, and withdrawn when switched off', () => {
    const { agent, registered } = fakeAgent()
    const show = previewToggle(tool)
    show(agent, true)
    show(agent, true)
    expect([...registered]).toEqual(['preview_scene'])
    show(agent, false)
    expect([...registered]).toEqual([])
    show(agent, true)
    expect([...registered]).toEqual(['preview_scene'])
  })

  it('is taken as shown when a copy of the plugin from before a reload already registered it', () => {
    const { agent, registered } = fakeAgent()
    ;(agent as { ctx: { tools: { register: (tool: { name: string }) => () => void } } }).ctx.tools.register(tool as { name: string })
    expect(() => { previewToggle(tool)(agent, true) }).not.toThrow()
    expect([...registered]).toEqual(['preview_scene'])
  })

  it('is not registered a second time by a plugin that was reloaded', () => {
    const { agent, registered } = fakeAgent()
    previewToggle(tool)(agent, true)
    const reloaded = previewToggle(tool)
    expect(() => { reloaded(agent, true) }).not.toThrow()
    reloaded(agent, false)
    expect([...registered]).toEqual([])
  })
})
