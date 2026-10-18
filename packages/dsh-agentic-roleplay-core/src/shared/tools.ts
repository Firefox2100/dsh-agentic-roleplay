import type { Switchboard } from './settings.ts'

/** The kinds of agent whose tools can be chosen. A character is not one agent but a kind: the choice is for all of them. */
export const AGENT_KINDS = ['gameMaster', 'characters', 'records'] as const
export type AgentKind = (typeof AGENT_KINDS)[number]

/** A tool the person may switch on or off for a kind of agent; the tool's own words (title, what it is for) are the interface's. */
export interface OptionalTool {
  id: string
  agent: AgentKind
  /** Whether the agent has it when nothing says otherwise. */
  default: boolean
}

/** What this version can offer. A name in a settings file or a world that is not here is kept and ignored. */
export const OPTIONAL_TOOLS: readonly OptionalTool[] = [
  { id: 'roll_check', agent: 'gameMaster', default: true },
  { id: 'roll_dice', agent: 'gameMaster', default: true },
  { id: 'list_checks', agent: 'gameMaster', default: true },
  { id: 'recall_my_memories', agent: 'characters', default: true },
  { id: 'recall_my_known_entities', agent: 'characters', default: true },
  { id: 'recall_my_lore', agent: 'characters', default: true },
  { id: 'search_events', agent: 'records', default: true },
  { id: 'list_threads', agent: 'records', default: true },
  { id: 'list_relationships', agent: 'records', default: true },
  { id: 'list_items', agent: 'records', default: true },
]

/** Whether an agent of this kind has a tool, by what the switches say and, failing that, by default. A tool this version does not offer is never on. */
export function toolEnabled(board: Switchboard, agent: AgentKind, id: string): boolean {
  const offered = OPTIONAL_TOOLS.find(tool => tool.agent === agent && tool.id === id)
  if (offered === undefined) return false
  return board[agent]?.[id] ?? offered.default
}

/** What the interface shows of one tool. */
export interface ToolSwitch {
  id: string
  enabled: boolean
  default: boolean
}

export interface AgentSwitches {
  agent: AgentKind
  tools: ToolSwitch[]
}

/** The tools this version offers for each kind of agent, as the switches stand; names it does not know are left out. */
export function switchesOf(board: Switchboard): AgentSwitches[] {
  return AGENT_KINDS.map(agent => ({
    agent,
    tools: OPTIONAL_TOOLS.filter(tool => tool.agent === agent).map(tool => ({ id: tool.id, enabled: toolEnabled(board, agent, tool.id), default: tool.default })),
  }))
}

/**
 * The switches after one is set. Names this version does not know stay as they were, and a switch set to what the tool is by default is dropped,
 * so that a settings file says only what was chosen.
 */
export function withSwitch(board: Switchboard, agent: AgentKind, id: string, enabled: boolean): Switchboard {
  const offered = OPTIONAL_TOOLS.find(tool => tool.agent === agent && tool.id === id)
  if (offered === undefined) throw new Error(`there is no tool "${id}" to switch for ${agent}`)
  const mine = { ...board[agent] }
  if (enabled === offered.default) delete mine[id]
  else mine[id] = enabled
  const next: Switchboard = { ...board, [agent]: mine }
  if (Object.keys(mine).length === 0) delete next[agent]
  return next
}

/** A tool that another plugin registered (a file or shell tool, an MCP server's tool), as the interface lists it. */
export interface ExternalTool {
  name: string
  description: string
}

/**
 * Whether an agent of this kind has a tool that is not one of this plugin's own: only when it was switched on. Such tools are off by default, because
 * they reach beyond the story (files, a shell, the web), and a name that no plugin registers now has no effect.
 */
export function externalEnabled(board: Switchboard, agent: AgentKind, name: string): boolean {
  return board[agent]?.[name] === true
}

/** The switches after an external tool is switched: only what is on is kept, so that a settings file says only what was chosen. */
export function withExternal(board: Switchboard, agent: AgentKind, name: string, enabled: boolean): Switchboard {
  const mine = { ...board[agent] }
  if (enabled) mine[name] = true
  else delete mine[name]
  const next: Switchboard = { ...board, [agent]: mine }
  if (Object.keys(mine).length === 0) delete next[agent]
  return next
}
