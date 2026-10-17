import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import { createTools as stateTools, createDiceTools } from '@dsh-agentic-roleplay/state'
import { createTools as masterTools } from '../orchestration/tools.ts'
import { externalEnabled, type AgentKind, type ExternalTool } from '../../shared/tools.ts'
import type { Switchboard } from '../../shared/settings.ts'

/** The part of DSH's tool registry this needs: what is registered for everyone. */
export interface ToolRegistry {
  schemas(): { name: string; description: string }[]
}

/** The reserved transport DSH presents tools through; it is never a tool of its own to switch. */
const RESERVED = new Set(['run_code'])

let own: ReadonlySet<string> | undefined

/** The names of every tool this plugin and the state plugin register themselves: the story's own, which are not for switching here. */
export function ownToolNames(): ReadonlySet<string> {
  own ??= new Set<string>([
    ...stateTools(() => undefined, { write: true, authoring: true }).map((tool: ToolDefinition) => tool.name),
    ...createDiceTools(() => undefined).map(tool => tool.name),
    ...masterTools({} as never).map(tool => tool.name),
  ])
  return own
}

/** The tools other plugins registered for everyone (a file or shell tool, an MCP server's tools), which a story can give to an agent. */
export function externalTools(registry: ToolRegistry): ExternalTool[] {
  const mine = ownToolNames()
  return registry.schemas().filter(tool => !mine.has(tool.name) && !RESERVED.has(tool.name)).map(tool => ({ name: tool.name, description: tool.description })).sort((a, b) => a.name.localeCompare(b.name))
}

/** The external tools that are registered now and that an agent of this kind has been given. */
export function externalGiven(registry: ToolRegistry, board: Switchboard, agent: AgentKind): string[] {
  return externalTools(registry).map(tool => tool.name).filter(name => externalEnabled(board, agent, name))
}

/** The external tools that are registered now and that an agent of this kind has not been given: they are taken away from it. */
export function externalWithheld(registry: ToolRegistry, board: Switchboard, agent: AgentKind): string[] {
  return externalTools(registry).map(tool => tool.name).filter(name => !externalEnabled(board, agent, name))
}
