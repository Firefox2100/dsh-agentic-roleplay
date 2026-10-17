import { describe, expect, it } from 'vitest'
import { translator } from 'dsh-roleplay-model'
import { resourceHint } from '../../../src/host/tools/resource-hint.ts'

const en = translator('en')
const zh = translator('zh')

describe('resourceHint', () => {
  it('says nothing to an agent that sees no resource tool, whatever servers exist', () => {
    expect(resourceHint(['mcp__searxng__searxng_web_search', 'narrate'], ['mcp__searxng__searxng_web_search'], en)).toBe('')
    expect(resourceHint([], [], en)).toBe('')
  })

  it('names the servers of any MCP tool when a resource tool is visible', () => {
    const text = resourceHint(['read_mcp_resource'], ['read_mcp_resource', 'mcp__searxng__web_search', 'mcp__my_files-2__read', 'mcp__searxng__other'], en)
    expect(text).toContain('read_mcp_resource')
    expect(text).toContain('["my_files-2","searxng"]')
    expect(text).not.toContain('list_mcp_resources')
  })

  it('still says how to use the tools when no server has a tool of its own', () => {
    expect(resourceHint(['list_mcp_resources'], ['list_mcp_resources'], en)).toContain('server argument')
  })

  it('speaks the chat language', () => {
    expect(resourceHint(['list_mcp_resources'], [], zh)).toContain('MCP 资源服务器')
  })
})
