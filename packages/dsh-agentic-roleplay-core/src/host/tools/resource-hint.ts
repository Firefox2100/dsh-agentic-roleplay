import type { Translate } from 'dsh-roleplay-model'

/** The name DSH's MCP resource plugin gives the prompt paragraph it adds for every agent; a section of the same name in an agent's scope replaces it. */
export const RESOURCE_HINT_SECTION = 'mcp-resource-servers'

const RESOURCE_TOOLS = ['list_mcp_resources', 'list_mcp_resource_templates', 'read_mcp_resource']
const NAMESPACED = /^mcp__(.+?)__.+$/

/**
 * What an agent is told about MCP resources: nothing unless it can see a resource tool, since the plugin's own paragraph names the tools
 * and servers to every agent whether or not it was given them, and an agent that is told of a tool it lacks goes looking for it. The servers are
 * those with a tool registered for anyone, so that an agent given only the resource tools still learns their names.
 */
export function resourceHint(visible: readonly string[], registered: readonly string[], tr: Translate): string {
  const tools = RESOURCE_TOOLS.filter(name => visible.includes(name))
  if (tools.length === 0) return ''
  const servers = [...new Set(registered.flatMap(name => NAMESPACED.exec(name)?.[1] ?? []))].sort()
  return servers.length === 0
    ? tr('## MCP resource servers\n\nUse {tools} with the server argument naming an MCP server.', { tools: tools.join(', ') })
    : tr('## MCP resource servers\n\nUse {tools} with one of these names as the server argument: {servers}.', { tools: tools.join(', '), servers: JSON.stringify(servers) })
}
