import type { ExternalTool } from '../../../shared/tools.ts'
import { API_PREFIX } from '../../../shared/worlds.ts'

/** The tools other plugins registered for everyone (a file or shell tool, an MCP server's), which an agent can be given. */
export async function loadExternalTools(signal: AbortSignal): Promise<ExternalTool[]> {
  const response = await fetch(`${API_PREFIX}/tools`, { credentials: 'same-origin', signal })
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`.trim())
  const body = await response.json() as { tools?: ExternalTool[] }
  return body.tools ?? []
}
